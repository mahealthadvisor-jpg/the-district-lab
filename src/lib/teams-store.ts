// Firestore-backed store for Teams.
// Phase 1C of the multi-coach migration (N1).
//
// Data shape: top-level `teams` collection. Each doc = one Team blob (folders,
// games, periods, roster) PLUS membership metadata for permission scoping:
//   - ownerId: uid of HC who created the team
//   - memberIds: array of uids with access (HC + invited ACs/VCs)
//   - memberRoles: map of uid → TeamRole
//
// Subscription: `subscribeToMyTeams(uid)` queries teams where memberIds
// contains the user's uid. Returns the user's full team list, real-time.
//
// Permission rules (firestore.rules) enforce:
//   - read/update/delete: caller's uid must be in memberIds
//   - create: any authenticated user (the creator becomes owner + sole member)

import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  updateDoc,
  Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { Team, TeamRole } from "./team-types";

const TEAMS_COLLECTION = "teams";

/** Internal Firestore shape — Team data + membership metadata. */
type StoredTeam = Team & {
  ownerId: string;
  memberIds: string[];
  memberRoles: Record<string, TeamRole>;
  createdAt?: ReturnType<typeof serverTimestamp>;
  updatedAt?: ReturnType<typeof serverTimestamp>;
};

/** Strip Firestore-only fields, return clean Team for the app. */
function fromStored(stored: Record<string, unknown>): Team {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ownerId, memberIds, memberRoles, createdAt, updatedAt, ...rest } =
    stored as StoredTeam;
  return rest as Team;
}

/**
 * Subscribe to all teams the given user has access to (memberIds contains uid).
 * Returns an unsubscribe function.
 */
export function subscribeToMyTeams(
  uid: string,
  onChange: (teams: Team[]) => void
): Unsubscribe {
  const q = query(
    collection(db, TEAMS_COLLECTION),
    where("memberIds", "array-contains", uid)
  );
  return onSnapshot(q, (snap) => {
    const teams: Team[] = [];
    snap.forEach((docSnap) => {
      teams.push(fromStored(docSnap.data()));
    });
    // Sort alphabetically by name for stable display order.
    teams.sort((a, b) => a.name.localeCompare(b.name));
    onChange(teams);
  });
}

/** Upsert a team. If new, sets owner = uid + sole member. */
export async function saveTeam(team: Team, ownerId: string): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, team.id);
  await setDoc(
    ref,
    {
      ...team,
      ownerId,
      memberIds: arrayUnion(ownerId),
      [`memberRoles.${ownerId}`]: "HC",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  // Set createdAt only on first write
  await setDoc(
    ref,
    { createdAt: serverTimestamp() },
    { merge: true, mergeFields: ["createdAt"] }
  ).catch(() => {});
}

/** Delete a team (only the owner should call this; rules enforce). */
export async function deleteTeam(teamId: string): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, teamId);
  await deleteDoc(ref);
}

/** Add a coach to a team's membership (owner-only via rules). */
export async function addMemberToTeam(
  teamId: string,
  uid: string,
  role: TeamRole
): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, teamId);
  await updateDoc(ref, {
    memberIds: arrayUnion(uid),
    [`memberRoles.${uid}`]: role,
    updatedAt: serverTimestamp(),
  });
}

/** Remove a coach from a team's membership (owner-only via rules). */
export async function removeMemberFromTeam(
  teamId: string,
  uid: string
): Promise<void> {
  const ref = doc(db, TEAMS_COLLECTION, teamId);
  await updateDoc(ref, {
    memberIds: arrayRemove(uid),
    [`memberRoles.${uid}`]: null, // soft-delete the role mapping
    updatedAt: serverTimestamp(),
  });
}
