import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ConversationHistory} from './src/ConversationHistory';
import {ConversationWindowContext} from './src/conversation-window-state';
import {JarvisActivityProvider} from './src/activity-provider';
import {MobileMenu,MobileBottomNav} from './src/MobileShell';
import {usePhoneChatViewport} from './src/phone-chat-viewport';
import './src/styles.css';
import './src/ConversationHistory.css';
class Recognition {
 static current; onresult; onerror; onend;
 constructor(){Recognition.current=this;}
 start(){} stop(){this.onerror?.({error:'aborted'});this.onend?.();} abort(){this.onerror?.({error:'aborted'});this.onend?.();}
}
window.SpeechRecognition=Recognition;
window.fixtureRecognition=Recognition;
function Fixture(){
 const shell=useRef(null),[menu,setMenu]=useState(false),[element,setElement]=useState(null),[height,setHeight]=useState(110);
 const phone=window.innerWidth<=700;
 usePhoneChatViewport(shell,phone);
 return <JarvisActivityProvider><MemoryRouter><div ref={shell} className="app-shell" data-phone={phone} data-home="true" data-voice-active="false" data-conversation-open="true" style={{'--conversation-composer-height':`${height}px`}}>
 <header className="app-topbar">Synthetic Send QA · #1315</header>
 <div className="workspace-shell-area"><div className="workspace-window workspace-window-conversation luminous-glass"><div ref={setElement} style={{height:'100%'}} /></div></div>
 <main className="jarvis-page"><ConversationWindowContext.Provider value={{element,setComposerHeight:setHeight,setAvailable:()=>{},open:true,setOpen:()=>true}}>
 <ConversationHistory client={{}} getAccessToken={async()=> 'synthetic'} config={{...__JARVIS_CONFIG__,backendUrl:'http://fixture.invalid'}} historyRefresh={0} phone={phone}/>
 </ConversationWindowContext.Provider></main>
 {phone && <MobileBottomNav dailyEnabled menuOpen={menu} onToggleWorkspaces={()=>{}} onOpenMenu={()=>setMenu(!menu)} onNavigate={()=>{}}/>}
 <MobileMenu open={menu} onClose={()=>setMenu(false)} onNavigate={()=>{}} onContext={()=>{}} proactiveEnabled/>
 </div></MemoryRouter></JarvisActivityProvider>
}
createRoot(document.getElementById('root')).render(<Fixture/>);
