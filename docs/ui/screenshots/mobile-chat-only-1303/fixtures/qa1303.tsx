import React, {useEffect} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter,useNavigate} from 'react-router-dom';import {App} from './src/App';import './src/styles.css';
class Recognition {onresult;onerror;onend;start(){}stop(){this.onend?.();}abort(){this.onend?.();}}
window.SpeechRecognition=Recognition;
const config={...__JARVIS_CONFIG__,backendUrl:'http://fixture.invalid'};
function Fixture(){const navigate=useNavigate();useEffect(()=>{window.fixtureNavigate=navigate},[navigate]);return <App config={config} dailyEnabled proactiveEnabled/>;}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[new URLSearchParams(location.search).get('route')||'/']}><Fixture/></MemoryRouter>);
