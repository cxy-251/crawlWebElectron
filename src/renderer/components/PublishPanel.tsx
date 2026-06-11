import { useState } from "react";
import { 
  Folder, Settings, FileText, PlayCircle, UploadCloud, 
  RefreshCw, Send, FolderOpen, Link2, User, CheckCircle2,
  ListPlus, LayoutGrid, Rocket, Square, ChevronUp, ChevronDown, Globe
} from "lucide-react";
import type { ReactElement } from "react";
import { PLATFORMS, type PlatformKey } from "../../shared/platforms";
import { usePublishViewModel } from "../hooks/usePublishViewModel";

export function PublishPanel(): ReactElement {
  const { state, computed, setters, actions } = usePublishViewModel();
  
  const [expandedCards, setExpandedCards] = useState({
    card1: true,
    card2: true,
    card3: true,
    card4: true
  });

  const toggleCard = (card: keyof typeof expandedCards) => {
    setExpandedCards(prev => ({ ...prev, [card]: !prev[card] }));
  };

  return (
    <>
      <style>{`
        /* Scoped CSS for 100% Guaranteed Layout */
        .pp-container {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          width: 100%;
          background-color: #1e1e2d; /* Perfect match with App.tsx tool-pane */
          overflow-y: auto;
          padding: 24px;
          gap: 24px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #e2e8f0;
          box-sizing: border-box;
          user-select: none;
          padding-bottom: 96px; /* pb-24 equivalent */
        }
        
        .pp-container * {
          box-sizing: border-box;
        }

        .pp-card {
          background: #232334;
          border: 1px solid #323249;
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
          flex-shrink: 0; /* Anti-squeeze */
          height: auto;
        }

        .pp-card-header {
          background: #2b2b40;
          padding: 16px 20px;
          border-bottom: 1px solid #323249;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          transition: background 0.2s;
          flex-shrink: 0;
        }

        .pp-card-header:hover {
          background: #323249;
        }

        .pp-header-title {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 13px;
          font-weight: 700;
          color: #cbd5e1;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          flex-shrink: 0;
        }

        .pp-card-body {
          padding: 20px;
          background: #1e1e2d;
          display: flex;
          flex-direction: column;
          gap: 24px;
          flex-shrink: 0;
          height: auto;
        }

        /* Forms */
        .pp-field-group {
          display: flex;
          gap: 20px;
          align-items: flex-end;
          width: 100%;
          flex-shrink: 0;
        }

        .pp-field {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
        }

        .pp-label {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          flex-shrink: 0;
        }

        .pp-input-wrapper {
          position: relative;
          display: flex;
          width: 100%;
          flex-shrink: 0;
        }

        .pp-input, .pp-select, .pp-textarea {
          width: 100%;
          background: #151521;
          border: 1px solid #323249;
          border-radius: 8px;
          color: #e2e8f0;
          font-size: 14px;
          padding: 12px 16px;
          outline: none;
          transition: all 0.2s;
          font-family: inherit;
          flex-shrink: 0;
        }
        
        .pp-input:focus, .pp-select:focus, .pp-textarea:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 1px #38bdf8;
        }

        .pp-input::placeholder, .pp-textarea::placeholder {
          color: #475569;
        }

        .pp-select {
          appearance: none;
          cursor: pointer;
        }

        .pp-textarea {
          resize: vertical;
          min-height: 142px;
          height: auto;
        }

        /* Buttons */
        .pp-btn-icon-inside {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: #94a3b8;
          padding: 6px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .pp-btn-icon-inside:hover {
          background: #2b2b40;
          color: #f8fafc;
        }

        .pp-btn-secondary {
          background: #2b2b40;
          border: 1px solid #323249;
          color: #cbd5e1;
          font-weight: 600;
          font-size: 13px;
          padding: 12px 16px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .pp-btn-secondary:hover:not(:disabled) {
          background: #323249;
          color: #f8fafc;
        }
        .pp-btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .pp-btn-primary {
          flex: 1;
          background: linear-gradient(90deg, #0ea5e9, #2563eb);
          border: none;
          color: #ffffff;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 0.1em;
          padding: 0 24px;
          min-height: 48px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 0 20px rgba(14, 165, 233, 0.3);
          flex-shrink: 0;
        }
        .pp-btn-primary:hover:not(:disabled) {
          background: linear-gradient(90deg, #38bdf8, #3b82f6);
          box-shadow: 0 0 30px rgba(14, 165, 233, 0.5);
        }
        .pp-btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }

        .pp-btn-danger {
          width: 96px;
          background: #2b2b40;
          border: 1px solid #323249;
          color: #cbd5e1;
          font-weight: 700;
          font-size: 13px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
          min-height: 48px;
        }
        .pp-btn-danger:hover {
          background: rgba(225, 29, 72, 0.2);
          border-color: #e11d48;
          color: #fb7185;
        }

        /* Execution Grid */
        .pp-execution-body {
          background: #151521;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          flex-shrink: 0;
        }

        .pp-grid-2x2 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          flex-shrink: 0;
        }

        .pp-action-row {
          display: flex;
          gap: 12px;
          min-height: 48px;
          flex-shrink: 0;
        }

        .pp-footer-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #2b2b40;
          border: 1px solid #323249;
          padding: 6px 16px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          letter-spacing: 0.1em;
          margin: 0 auto;
          flex-shrink: 0;
        }
      `}</style>

      <section className="pp-container">
        
        {/* CARD 1: SESSION & ACCOUNT STATE */}
        <div className="pp-card">
          <div className="pp-card-header" onClick={() => toggleCard('card1')}>
            <div className="pp-header-title">
              <User size={15} color="#94a3b8" />
              <span>SESSION & ACCOUNT STATE</span>
            </div>
            {expandedCards.card1 ? <ChevronUp size={14} color="#64748b"/> : <ChevronDown size={14} color="#64748b"/>}
          </div>
          
          {expandedCards.card1 && (
            <div className="pp-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              {/* Row 1: Account & Platform Select */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                {/* Left: Account info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '40px', height: '40px', background: '#1e293b', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #475569' }}>
                    <User size={20} color="#94a3b8" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>ACCOUNT</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffffff' }}>{state.username}</span>
                      <button 
                        onClick={() => void actions.handleFetchUserInfo()}
                        disabled={state.isFetchingUser}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#38bdf8' }}
                        title="Sync Profile from Browser"
                      >
                        <RefreshCw size={14} className={state.isFetchingUser ? 'spin' : ''} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right: Platform Select */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', background: '#1e293b', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #475569' }}>
                    <PlayCircle size={18} color="#22d3ee" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Platform</span>
                    <select 
                      value={state.platform} 
                      onChange={(e) => setters.setPlatform(e.target.value as PlatformKey)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        outline: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        WebkitAppearance: 'none',
                      }}
                    >
                      {Object.entries(PLATFORMS).map(([key, data]) => (
                        <option key={key} value={key} style={{ color: '#000' }}>
                          {data.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Row 2: URL & Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: 'rgba(30, 41, 59, 0.4)', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', wordBreak: 'break-all', flex: 1, minWidth: '200px' }}>
                  <span style={{ color: '#64748b', marginRight: '6px' }}>URL:</span> 
                  {computed.currentConfig.url}
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                  <button 
                    onClick={() => void actions.handleNavigate()} 
                    disabled={state.isNavigating}
                    className="pp-btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', minHeight: 'unset', height: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Send size={12} /> {state.isNavigating ? "Loading..." : "Navigate"}
                  </button>
                  <button 
                    onClick={() => void actions.handleGetCookies()} 
                    className="pp-btn-secondary"
                    title="Get Session Cookies"
                    style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', minHeight: 'unset', height: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <FolderOpen size={12} /> Cookies
                  </button>
                  <button 
                    onClick={() => void actions.handleExecuteJs()} 
                    className="pp-btn-secondary"
                    title="Execute test script: document.title"
                    style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px', minHeight: 'unset', height: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <PlayCircle size={12} /> Exec JS
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(6, 78, 59, 0.3)', border: '1px solid #065f46', borderRadius: '6px' }}>
                    <CheckCircle2 size={14} color="#34d399" />
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#34d399', letterSpacing: '0.05em' }}>STATUS: VERIFIED</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CARD 2: CONTENT PARAMETERS */}
        <div className="pp-card">
          <div className="pp-card-header" onClick={() => toggleCard('card2')}>
            <div className="pp-header-title">
              <Settings size={15} color="#94a3b8" />
              <span>CONTENT PARAMETERS</span>
            </div>
            {expandedCards.card2 ? <ChevronUp size={14} color="#64748b"/> : <ChevronDown size={14} color="#64748b"/>}
          </div>
          
          {expandedCards.card2 && (
            <div className="pp-card-body">
              <div className="pp-field-group">
                <div className="pp-field">
                  <label className="pp-label">Media Source File</label>
                  <div className="pp-input-wrapper">
                    <input type="text" readOnly value={state.filePath} placeholder="/path/to/media.mp4" className="pp-input" style={{ paddingRight: '40px' }} />
                    <button type="button" onClick={() => void actions.handleSelectFile()} className="pp-btn-icon-inside">
                      <Folder size={16} />
                    </button>
                  </div>
                </div>
                <div className="pp-field">
                  <label className="pp-label">Schedule Publishing Time</label>
                  <input type="text" value={state.publishTime} onChange={(e) => setters.setPublishTime(e.target.value)} placeholder="2024-01-01 18:00" className="pp-input" />
                </div>
              </div>
              
              <div className="pp-field-group">
                <div className="pp-field">
                  <label className="pp-label">Target Playlist/Collection</label>
                  <select value={state.collection} onChange={(e) => setters.setCollection(e.target.value)} className="pp-select">
                    <option value="">Select Playlist...</option>
                    {state.availablePlaylists && state.availablePlaylists.map(pl => (
                      <option key={pl} value={pl}>{pl}</option>
                    ))}
                  </select>
                </div>
                <div className="pp-field">
                  <label className="pp-label">Local Invisible (同城隐藏)</label>
                  <select value={state.localInvisible ? "true" : "false"} onChange={(e) => setters.setLocalInvisible(e.target.value === "true")} className="pp-select">
                    <option value="false">Visible</option>
                    <option value="true">Hidden</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CARD 3: CONTENT METADATA DETAILS */}
        <div className="pp-card">
          <div className="pp-card-header" onClick={() => toggleCard('card3')}>
            <div className="pp-header-title">
              <FileText size={15} color="#94a3b8" />
              <span>CONTENT METADATA DETAILS</span>
            </div>
            {expandedCards.card3 ? <ChevronUp size={14} color="#64748b"/> : <ChevronDown size={14} color="#64748b"/>}
          </div>
          
          {expandedCards.card3 && (
            <div className="pp-card-body">
              <div className="pp-field-group" style={{ alignItems: 'flex-start' }}>
                <div className="pp-field" style={{ flex: 1.5 }}>
                  <label className="pp-label">Video Title</label>
                  <input type="text" value={state.title} onChange={(e) => setters.setTitle(e.target.value)} placeholder="Main Video Title" className="pp-input" style={{ marginBottom: '16px' }} />
                  
                  <label className="pp-label">Video Description</label>
                  <textarea value={state.description} onChange={(e) => setters.setDescription(e.target.value)} placeholder="Description & hashtags" className="pp-textarea" style={{ minHeight: '94px', height: 'auto' }} />
                </div>
                <div className="pp-field" style={{ flex: 1, gap: '20px' }}>
                  <div className="pp-field" style={{ width: '100%' }}>
                    <label className="pp-label">Hashtags</label>
                    <input type="text" value={state.tags} onChange={(e) => setters.setTags(e.target.value)} placeholder="#hashtags #example" className="pp-input" />
                  </div>
                  <div className="pp-field" style={{ width: '100%' }}>
                    <label className="pp-label">Custom Cover Image</label>
                    <div className="pp-input-wrapper">
                      <input type="text" readOnly value={state.coverPath} placeholder="/path/to/cover.jpg" className="pp-input" style={{ paddingRight: '40px' }} />
                      <button type="button" onClick={() => void actions.handleSelectCover()} className="pp-btn-icon-inside">
                        <Folder size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CARD 4: EXECUTION & TASK PANEL */}
        <div className="pp-card">
          <div className="pp-card-header" onClick={() => toggleCard('card4')}>
            <div className="pp-header-title">
              <PlayCircle size={15} color="#94a3b8" />
              <span>EXECUTION & TASK PANEL</span>
            </div>
            {expandedCards.card4 ? <ChevronUp size={14} color="#64748b"/> : <ChevronDown size={14} color="#64748b"/>}
          </div>
          
          {expandedCards.card4 && (
            <div className="pp-execution-body">
              <div className="pp-grid-2x2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <button type="button" onClick={() => void actions.handleSelectFile()} className="pp-btn-secondary">
                  <FolderOpen size={14} /> Open
                </button>
                <button type="button" onClick={() => void actions.handleMountVideo()} disabled={!computed.canMount} className="pp-btn-secondary">
                  <Link2 size={14} /> Attach
                </button>
                <button type="button" onClick={() => void actions.handleSyncForm()} disabled={!computed.canSync} className="pp-btn-secondary">
                  <ListPlus size={14} /> Queue Task
                </button>
              </div>
              <button 
                type="button" 
                onClick={() => void actions.handleSubmit()} 
                disabled={state.isSubmitting} 
                className="pp-btn-primary"
                style={{ width: '100%', marginTop: '8px' }}
              >
                <Rocket size={18} /> PUBLISH TASK
              </button>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
                <div className="pp-footer-badge">
                  TOTAL TASKS: 145
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
