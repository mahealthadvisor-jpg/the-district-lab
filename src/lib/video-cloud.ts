// Cloud video storage for multi-coach playback.
// Phase 1C+ of the multi-coach migration (N1). Firebase Storage v1.
// (R2 migration is a future session — just swap the implementation here;
// the API surface stays the same.)
//
// Architecture:
//   - File bytes live in Firebase Storage at videos/{periodId}/{filename}
//   - Pointer doc in Firestore at /videos/{periodId}:
//       { periodId, teamId, cloudPath, uploadedBy, uploadedAt, size, contentType }
//   - Existing IndexedDB local storage is kept as a cache for the uploader's
//     browser (instant playback, no re-download). Other coaches fetch from cloud.

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  UploadTask,
} from "firebase/storage";
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { storage, db } from "./firebase";

const VIDEOS_COLLECTION = "videos";

export interface VideoCloudRef {
  periodId: string;
  teamId?: string;
  cloudPath: string;
  uploadedBy: string;
  size?: number;
  contentType?: string;
}

/**
 * Upload a video file to cloud storage + register it in Firestore.
 * Returns an UploadTask so the caller can show progress / abort.
 */
export function uploadVideoToCloud(
  file: File,
  periodId: string,
  teamId: string,
  ownerId: string
): { task: UploadTask; donePromise: Promise<VideoCloudRef> } {
  // Sanitize filename — keep extension, strip unsafe chars
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const cloudPath = `videos/${periodId}/${safeName}`;
  const storageRef = ref(storage, cloudPath);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "video/mp4",
  });

  const donePromise = new Promise<VideoCloudRef>((resolve, reject) => {
    task.on(
      "state_changed",
      undefined,
      (err) => reject(err),
      async () => {
        try {
          const cloudRef: VideoCloudRef = {
            periodId,
            teamId,
            cloudPath,
            uploadedBy: ownerId,
            size: file.size,
            contentType: file.type || "video/mp4",
          };
          await setDoc(doc(db, VIDEOS_COLLECTION, periodId), {
            ...cloudRef,
            uploadedAt: serverTimestamp(),
          });
          resolve(cloudRef);
        } catch (err) {
          reject(err);
        }
      }
    );
  });

  return { task, donePromise };
}

/** Get a download URL for the video registered to this period. Returns null if not in cloud. */
export async function getCloudVideoUrl(periodId: string): Promise<string | null> {
  const snap = await getDoc(doc(db, VIDEOS_COLLECTION, periodId));
  if (!snap.exists()) return null;
  const data = snap.data() as VideoCloudRef;
  try {
    return await getDownloadURL(ref(storage, data.cloudPath));
  } catch {
    return null;
  }
}

/** Delete the cloud video for a period (Firestore doc + Storage file). */
export async function deleteCloudVideo(periodId: string): Promise<void> {
  const docRef = doc(db, VIDEOS_COLLECTION, periodId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return;
  const data = snap.data() as VideoCloudRef;
  await Promise.all([
    deleteObject(ref(storage, data.cloudPath)).catch(() => {
      // ignore — file might already be missing
    }),
    deleteDoc(docRef),
  ]);
}

/** Quick check — does a cloud video exist for this period without downloading the URL? */
export async function cloudVideoExists(periodId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, VIDEOS_COLLECTION, periodId));
  return snap.exists();
}
