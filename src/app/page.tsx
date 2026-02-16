"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Activity, HardDrive, Plus, Film, ChevronRight, FolderPlus, Folder, Home, Library, Users, PlayCircle } from "lucide-react";

// CATEGORIES WITH UPDATED MANUAL LOGIC FOR PK IZ AND PK FC
const CATEGORIES = {
  Attacking: [
    { id: 'breakout', label: 'Breakout', hotkey: 'b', mode: 'manual' },
    { id: 'pp_breakout', label: 'PP Breakout', hotkey: 'shift+b', mode: 'manual' },
    { id: 'ozp', label: 'OZP', hotkey: 'o', mode: 'manual' },
    { id: 'pp_ozp', label: 'PP OZP', hotkey: 'shift+o', mode: 'manual' },
    { id: 'chance_for', label: 'Chance For', hotkey: 'c', mode: 'instant', pre: 10, post: 10 },
    { id: 'goal_for', label: 'Goal For', hotkey: 'g', mode: 'instant', pre: 10, post: 10 },
    { id: 'nzo', label: 'NZO', hotkey: 'n', mode: 'instant', pre: 4, post: 4 },
  ],
  Defending: [
    { id: 'dzc', label: 'DZC', hotkey: 'd', mode: 'manual' },
    { id: 'nzd', label: 'NZD', hotkey: 'z', mode: 'instant', pre: 4, post: 4 },
    { id: 'pk_iz', label: 'PK IZ', hotkey: 'i', mode: 'manual' }, // Switched to manual
    { id: 'pk_fc', label: 'PK FC', hotkey: 'f', mode: 'manual' }, // Switched to manual
    { id: 'fc', label: 'FC', hotkey: 'v', mode: 'manual' },
    { id: 'chance_against', label: 'Chance Against', hotkey: 'a', mode: 'instant', pre: 10, post: 10 },
    { id: 'goal_against', label: 'Goal Against', hotkey: 'h', mode: 'instant', pre: 10, post: 10 },
  ],
  Other: [
    { id: 'faceoff', label: 'Faceoff', hotkey: 'x', mode: 'instant', pre: 10, post: 10 },
    { id: 'bb_comment', label: 'BB Comment', hotkey: 'm', mode: 'manual' },
    { id: 'goalie_touch', label: 'Goalie Touch', hotkey: 't', mode: 'instant', pre: 4, post: 4 },
    { id: 'ref_clip', label: 'Ref Clip', hotkey: 'r', mode: 'instant', pre: 4, post: 4 },
  ]
};

export default function DistrictPlatform() {
  const [currentView, setCurrentView] = useState('scout');
  const [isClient, setIsClient] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [teams, setTeams] = useState([{ id: 'triton', name: 'Triton High', games: [{ id: 'triton-26', name: 'vs NBPT', file: 'triton.mp4' }] }]);
  const [selectedGame, setSelectedGame] = useState(teams[0].games[0]);
  const [events, setEvents] = useState<any[]>([]);
  const [activeManualTags, setActiveManualTags] = useState<Record<string, number>>({});
  const [isPaused, setIsPaused] = useState(true);

  useEffect(() => {
    setIsClient(true);
    const savedTeams = localStorage.getItem('district_teams');
    if (savedTeams) setTeams(JSON.parse(savedTeams));
  }, []);

  useEffect(() => {
    if (isClient && selectedGame) {
      localStorage.setItem('district_teams', JSON.stringify(teams));
      const savedEvents = localStorage.getItem(`district_tags_${selectedGame.id}`);
      setEvents(savedEvents ? JSON.parse(savedEvents) : []);
    }
  }, [selectedGame, isClient, teams]);

  useEffect(() => {
    if (isClient && selectedGame) {
      localStorage.setItem(`district_tags_${selectedGame.id}`, JSON.stringify(events));
    }
  }, [events, selectedGame, isClient]);

  const handleTag = useCallback((action: any) => {
    if (!videoRef.current || currentView !== 'scout') return;
    const now = videoRef.current.currentTime;
    if (action.mode === 'manual') {
      if (activeManualTags[action.id] !== undefined) {
        setEvents(prev => [{ id: Date.now(), type: action.label, start: activeManualTags[action.id], end: now, comment: "" }, ...prev]);
        setActiveManualTags(prev => { const next = { ...prev }; delete next[action.id]; return next; });
      } else { setActiveManualTags(prev => ({ ...prev, [action.id]: now })); }
    } else {
      setEvents(prev => [{ id: Date.now(), type: action.label, start: Math.max(0, now - action.pre), end: now + action.post, comment: "" }, ...prev]);
    }
  }, [activeManualTags, selectedGame, currentView]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); isPaused ? videoRef.current?.play() : videoRef.current?.pause(); setIsPaused(!isPaused); }
      const key = e.key.toLowerCase();
      Object.values(CATEGORIES).flat().forEach(a => { if (a.hotkey === key) handleTag(a); });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleTag, isPaused]);

  if (!isClient) return null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
      <header className="border-b border-slate-800 bg-slate-950 px-6 py-3 flex items-center justify-between shadow-2xl z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-1.5 rounded-md"><Activity size={18} /></div>
            <h1 className="text-sm font-black italic uppercase tracking-wider text-white">The District</h1>
          </div>
          <nav className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800">
            {[{ id: 'home', label: 'Home', icon: Home }, { id: 'library', label: 'Library', icon: Library }, { id: 'scout', label: 'Scouting Lab', icon: Film }, { id: 'meeting', label: 'Meetings', icon: Users }].map((tab) => (
              <button key={tab.id} onClick={() => setCurrentView(tab.id)} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${currentView === tab.id ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>
                <tab.icon size={14} /> {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 bg-slate-900 px-4 py-2 rounded-full border border-slate-800 text-[9px] font-mono font-bold">
           <HardDrive size={12} className="text-amber-500" /> 7.54 GB / 16 GB
        </div>
      </header>

      {currentView === 'scout' ? (
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-52 border-r border-slate-800 bg-slate-950/50 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-800 text-[9px] font-black uppercase text-slate-500">Active Vault</div>
            <div className="p-2 space-y-4 overflow-y-auto">
              {teams.map(team => (
                <div key={team.id} className="space-y-1">
                  <div className="px-2 text-[8px] font-black text-slate-600 uppercase italic flex justify-between items-center">{team.name}</div>
                  {team.games.map(g => (
                    <button key={g.id} onClick={() => setSelectedGame(g)} className={`w-full text-left p-2 rounded-md text-[9px] font-bold truncate ${selectedGame.id === g.id ? 'text-emerald-500 bg-emerald-500/10' : 'text-slate-400'}`}>{g.name}</button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <main className="flex-1 flex p-4 gap-4 overflow-hidden bg-slate-950">
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto min-w-0 pr-2">
              <div className="bg-black rounded-xl border-2 border-slate-800 overflow-hidden shadow-2xl aspect-video shrink-0 relative">
                <video key={selectedGame.file} ref={videoRef} src={`/games/${selectedGame.file}`} className="w-full h-full object-contain" controls />
              </div>

              <div className="grid grid-cols-3 gap-6 pb-12">
                {Object.entries(CATEGORIES).map(([catName, actions]) => (
                  <div key={catName} className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800/60 shadow-lg">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-2">
                      <span className={`w-1.5 h-4 rounded-full ${catName === 'Attacking' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-300">{catName}</h3>
                    </div>
                    <div className="grid gap-2.5">
                      {actions.map(action => (
                        <button key={action.id} onClick={() => handleTag(action)} className={`w-full p-4 rounded-xl font-black text-[10px] uppercase tracking-widest border-2 transition-all flex justify-between items-center ${activeManualTags[action.id] !== undefined ? 'bg-red-600 border-red-400 animate-pulse text-white shadow-lg shadow-red-900/40' : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'}`}>
                          <div className="flex items-center gap-2.5">
                            {action.mode === 'manual' && <div className={`w-2 h-2 rounded-full ${activeManualTags[action.id] ? 'bg-white' : 'bg-red-500'}`} />}
                            {action.label}
                          </div>
                          <span className="opacity-30 font-mono text-[9px]">[{action.hotkey.toUpperCase()}]</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-60 flex flex-col bg-slate-900/20 rounded-xl border border-slate-800 overflow-hidden shrink-0 shadow-inner">
               <div className="p-3 border-b border-slate-800 font-black text-[9px] text-slate-500 uppercase tracking-widest flex justify-between items-center">Meeting Log <span className="bg-emerald-500 text-white px-1.5 py-0.5 rounded text-[8px]">{events.length}</span></div>
               <div className="flex-1 overflow-y-auto p-3 space-y-3">
                 {events.map(e => (
                   <div key={e.id} className="bg-slate-950 p-3 rounded-lg border-l-4 border-emerald-600 shadow-md">
                     <div className="flex justify-between items-center mb-2">
                       <span className="text-[9px] font-black text-emerald-500 uppercase italic tracking-tighter">{e.type}</span>
                       <button onClick={() => { if(videoRef.current) videoRef.current.currentTime = e.start }} className="text-[9px] font-mono text-slate-500 hover:text-emerald-400"><PlayCircle size={10}/></button>
                     </div>
                     <textarea value={e.comment} onChange={(ev) => setEvents(prev => prev.map(evt => evt.id === e.id ? { ...evt, comment: ev.target.value } : evt))} className="w-full bg-slate-900/40 text-[10px] text-slate-300 p-2 rounded h-14 border-none focus:ring-1 focus:ring-emerald-500 resize-none" placeholder="Note..." />
                   </div>
                 ))}
               </div>
            </div>
          </main>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-20 text-center bg-slate-950">
          <div className="bg-slate-900 p-10 rounded-3xl border border-slate-800 shadow-2xl max-w-2xl">
            <h2 className="text-2xl font-black uppercase italic mb-4">Entering <span className="text-emerald-500 uppercase">{currentView}</span> Mode</h2>
            <p className="text-slate-400 leading-relaxed mb-8 font-medium italic">"The District" is evolving into a full-scale scouting platform.</p>
          </div>
        </div>
      )}
    </div>
  );
}