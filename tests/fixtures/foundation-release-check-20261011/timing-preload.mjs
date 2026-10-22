// Bounded-run instrumentation of Node processes created by this QA command.
import { appendFileSync } from 'node:fs';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { threadId } from 'node:worker_threads';
const output='tests/fixtures/foundation-release-check-20261011/process-timing.jsonl';
const record = event => appendFileSync(output,JSON.stringify({pid:process.pid,ppid:process.ppid,threadId,at:performance.timeOrigin+performance.now(),...event})+'\n');
const readHrTime=process.hrtime.bigint;
const now=()=>Number(readHrTime())/1e6;
let last=now(),cpu=process.cpuUsage();
record({kind:'process-start'});
const timer=setInterval(()=>{const current=now(),gap=current-last;if(gap>500)record({kind:'process-timer-gap',elapsedMs:gap,cpuUs:process.cpuUsage(cpu),memory:process.memoryUsage()});last=current;cpu=process.cpuUsage();},100);
timer.unref();
const gc=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.duration>100)record({kind:'gc',durationMs:e.duration});});
gc.observe({entryTypes:['gc']});
process.on('exit',code=>{clearInterval(timer);gc.disconnect();record({kind:'process-exit',code});});
