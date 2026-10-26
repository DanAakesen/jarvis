import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {App} from './src/App';import './src/styles.css';
class Recognition { static current; onresult;onerror;onend; constructor(){Recognition.current=this;}start(){}stop(){this.onerror?.({error:'aborted'});this.onend?.();}abort(){this.onend?.();}}
window.SpeechRecognition=Recognition;window.fixtureRecognition=Recognition;
createRoot(document.getElementById('root')).render(<MemoryRouter><App config={{...__JARVIS_CONFIG__,backendUrl:'http://fixture.invalid'}} dailyEnabled proactiveEnabled /></MemoryRouter>);
