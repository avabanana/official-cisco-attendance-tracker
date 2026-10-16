import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { JSDOM } from 'jsdom';
import { MemberCard } from '../src/components/MemberCard.tsx';
import { blank, checkIn, checkOut } from '../server/attendance.ts';

test('member Re-In button invokes exactly one explicit action; rendering never checks anyone in',async()=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
  Object.defineProperty(globalThis,'window',{value:dom.window,configurable:true});
  Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const {render,fireEvent,cleanup}=await import('@testing-library/react');
  const student={id:'test-person',name:'Person, Test',firstName:'Test',lastName:'Person'};
  const record=blank('2026-10-16',student);checkIn(record,Date.parse('2026-10-16T22:00:00Z'),'device');checkOut(record,Date.parse('2026-10-16T22:30:00Z'),'device');
  let clicks=0;
  const view=render(<MemberCard student={student} record={record} onCheckIn={()=>{clicks++;}} onCheckOut={()=>{}} />);
  assert.equal(clicks,0);
  const reIn=view.getByRole('button',{name:'Re-In'}) as HTMLButtonElement;
  assert.equal(reIn.disabled,false);fireEvent.click(reIn);assert.equal(clicks,1);
  cleanup();dom.window.close();
});

test('app ignores poisoned attendance cache, never posts on page load/date changes, and rolls back failed actions',async t=>{
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost'});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,localStorage:dom.window.localStorage})) {
    Object.defineProperty(globalThis,key,{value,configurable:true});
  }
  class Events { addEventListener(){} close(){} }
  Object.defineProperty(globalThis,'EventSource',{value:Events,configurable:true});
  const previousFetch=globalThis.fetch;
  const calls:Array<{url:string;method:string}>=[];
  const pending=new Map<string,(value:any)=>void>();
  let rejectAction:(error:Error)=>void=()=>{};
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const student={id:'test-person',name:'Person, Test',firstName:'Test',lastName:'Person'};
  const poisoned=blank(date,student);checkIn(poisoned,Date.now(),'old-device');
  dom.window.localStorage.setItem(`club_records_${date}`,JSON.stringify({[student.id]:poisoned}));
  globalThis.fetch=(async (url:any,options:any={})=>{
    const endpoint=String(url);calls.push({url:endpoint,method:options.method||'GET'});
    if(endpoint==='/api/checkin') return new Promise((_resolve,reject)=>{rejectAction=reject;});
    if(endpoint.startsWith('/api/attendance')) {
      const requested=new URL(endpoint,'http://localhost').searchParams.get('date')!;
      if(requested!==date) return new Promise(resolve=>{pending.set(requested,resolve);});
      return new Response(JSON.stringify({date:requested,records:[blank(requested,student)]}),{status:200});
    }
    const body=endpoint==='/api/roster'?{roster:[student]}:endpoint==='/api/alerts'?{alerts:[]}:endpoint==='/api/settings'?{strictMode:false,soundAlerts:false,kioskMode:true}:{};
    return new Response(JSON.stringify(body),{status:200});
  }) as any;
  t.after(()=>{globalThis.fetch=previousFetch;dom.window.close();});
  const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
  const {default:App}=await import('../src/App.tsx');
  const view=render(<App/>);t.after(cleanup);
  await waitFor(()=>assert.equal((view.container.querySelector('#btn-checkin-test-person') as HTMLButtonElement)?.disabled,false));
  assert.equal(calls.filter(c=>c.method==='POST').length,0);
  assert.match(view.container.querySelector('#member-row-test-person')!.textContent!,/Not Arrived/);
  fireEvent.click(view.container.querySelector('#btn-checkin-test-person')!);
  assert.match(view.container.querySelector('#member-row-test-person')!.textContent!,/Not Arrived/);
  await act(async()=>{rejectAction(new Error('simulated network failure'));});
  await waitFor(()=>assert.equal((view.container.querySelector('#btn-checkin-test-person') as HTMLButtonElement).disabled,false));
  assert.match(view.container.querySelector('#member-row-test-person')!.textContent!,/Not Arrived/);
  const input=view.container.querySelector('#input-attendance-date')!;
  fireEvent.change(input,{target:{value:'2026-10-12'}});
  fireEvent.change(input,{target:{value:'2026-10-13'}});
  await waitFor(()=>assert.ok(pending.has('2026-10-13')));
  await act(async()=>{pending.get('2026-10-13')!(new Response(JSON.stringify({date:'2026-10-13',records:[blank('2026-10-13',student)]})));});
  const stale=blank('2026-10-12',student);checkIn(stale,Date.now(),'old-device');
  await act(async()=>{pending.get('2026-10-12')!(new Response(JSON.stringify({date:'2026-10-12',records:[stale]})));});
  assert.match(view.container.querySelector('#member-row-test-person')!.textContent!,/Not Arrived/);
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
});
