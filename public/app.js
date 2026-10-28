const rules = [
  ['V-01','Missing Required Fields','BLOCKING','REJECTED','Name, date of birth, programme, category or admission date is absent.'],
  ['V-02','Missing APAAR ID','WARNING','FLAGGED','APAAR identifier is missing; the row remains in enrolment accounting.'],
  ['V-03','APAAR Format Mismatch','WARNING','FLAGGED','APAAR identifier is not a 12-digit numeric value.'],
  ['V-04','Duplicate APAAR in Single Submission','WARNING','FLAGGED','Multiple rows in one upload claim the same APAAR identifier.'],
  ['V-05','Multiple Active Enrolments','WARNING','FLAGGED','Concurrent active enrolments are found within or across institutions.'],
  ['V-06','Invalid Demographic / Date Values','BLOCKING','REJECTED','Dates are impossible or age at admission is outside 14–70 years.'],
  ['V-07','Admission Outside Window','WARNING','FLAGGED','Admission falls outside the regulatory academic intake window.'],
  ['V-08','Seat Category / Quota Conflict','WARNING','FLAGGED','Seat and quota tags contradict one another.'],
  ['V-09','Approved Regular Intake Excess','WARNING','FLAGGED','Programme regular enrolment exceeds its approved intake.'],
  ['V-10','Supernumerary Quota Ceiling Excess','WARNING','FLAGGED','A specific supernumerary seat limit is exceeded.'],
  ['V-11','Supernumerary Ineligible Category','WARNING','FLAGGED','A supernumerary claim is made under an ineligible category.'],
  ['V-12','Approved Programme Zero Enrolment','INFO','FLAGGED','An approved programme reports zero student enrolments.']
];

const list = document.getElementById('ruleList');
const search = document.getElementById('ruleSearch');
const filters = document.querySelectorAll('[data-filter]');
let activeFilter = 'all';
function renderRules(){
  const term = search.value.trim().toLowerCase();
  const rows = rules.filter(r => (activeFilter === 'all' || r[2] === activeFilter) && (r.join(' ').toLowerCase().includes(term)));
  list.innerHTML = rows.length ? rows.map(r => `<div class="rule-row"><span class="rule-code">${r[0]}</span><div><div class="rule-name">${r[1]}</div><div class="rule-desc">${r[4]}</div></div><span class="severity ${r[2].toLowerCase()}">${r[2]}</span><span class="outcome">${r[3]}</span></div>`).join('') : '<div class="rule-empty">No rules match your search.</div>';
}
filters.forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; filters.forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderRules(); }));
search.addEventListener('input', renderRules);
renderRules();

const menuButton = document.getElementById('menuButton');
const topNav = document.querySelector('.top-nav');
menuButton.addEventListener('click', () => { const open = topNav.classList.toggle('open'); menuButton.setAttribute('aria-expanded', String(open)); menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); });
topNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { topNav.classList.remove('open'); menuButton.setAttribute('aria-expanded','false'); menuButton.setAttribute('aria-label','Open menu'); }));

function validDate(value){ if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const [y,m,d] = value.split('-').map(Number); const date = new Date(Date.UTC(y,m-1,d)); return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d ? date : null; }
function ageAt(dob,admission){ let age=admission.getUTCFullYear()-dob.getUTCFullYear(); if(admission.getUTCMonth()<dob.getUTCMonth() || (admission.getUTCMonth()===dob.getUTCMonth() && admission.getUTCDate()<dob.getUTCDate())) age--; return age; }
function evaluateRecord(v){
  const findings=[];
  const add=(id,title,detail,severity)=>findings.push({id,title,detail,severity});
  if(!v.name || !v.dob || !v.programme || !v.category || !v.admission) add('V-01','Missing required fields','Provide name, DOB, programme, seat category and admission date.','BLOCKING');
  if(!v.apaar) add('V-02','Missing APAAR ID','Add a verified APAAR ID when available; this row still counts toward enrolment.','WARNING');
  else if(!/^\d{12}$/.test(v.apaar)) add('V-03','APAAR format mismatch','Expected 12 numeric digits; observed '+v.apaar.replace(/[^0-9]/g,'•').slice(0,16)+'.','WARNING');
  const dob=validDate(v.dob), admission=validDate(v.admission);
  if((v.dob&&!dob)||(v.admission&&!admission)||(dob&&admission&&(ageAt(dob,admission)<14||ageAt(dob,admission)>70))) add('V-06','Invalid demographic or date values','Use valid dates and an age at admission between 14 and 70 years.','BLOCKING');
  if(admission && (admission.getUTCMonth()<5 || admission.getUTCMonth()>10)) add('V-07','Admission outside sample window','The sample intake window is June–November; check the applicable regulatory calendar.','WARNING');
  return findings;
}
const form=document.getElementById('demoForm');
form.noValidate=true;
function runEvaluation(){
  const v={name:document.getElementById('studentName').value.trim(),dob:document.getElementById('dob').value,apaar:document.getElementById('apaar').value.trim(),admission:document.getElementById('admissionDate').value,programme:document.getElementById('programme').value,category:document.getElementById('category').value};
  const findings=evaluateRecord(v);
  const status=findings.some(f=>f.severity==='BLOCKING')?'REJECTED':findings.length?'FLAGGED':'ACCEPTED';
  const statusEl=document.getElementById('resultStatus');statusEl.className='result-status '+status.toLowerCase();statusEl.querySelector('.result-symbol').textContent=status==='ACCEPTED'?'✓':status==='FLAGGED'?'!':'×';statusEl.querySelector('h3').textContent=status;
  document.getElementById('resultSummary').textContent=status==='ACCEPTED'?'This sample record passes the demonstrated row-level checks.':status==='FLAGGED'?'This record can be counted, but one or more findings need review.':'This record has a blocking issue that must be corrected.';
  document.getElementById('findingCount').textContent=findings.length+' '+(findings.length===1?'issue':'issues');
  const container=document.getElementById('findings');container.replaceChildren();
  if(!findings.length){const el=document.createElement('div');el.className='no-findings';el.textContent='✓  No issues found in the demonstrated checks.';container.append(el);}
  findings.forEach(f=>{const el=document.createElement('div');el.className='finding '+(f.severity==='BLOCKING'?'blocking':'');const title=document.createElement('strong');title.textContent=f.id+' · '+f.title;const detail=document.createElement('span');detail.textContent=f.detail;el.append(title,detail);container.append(el);});
}
form.addEventListener('submit', event => { event.preventDefault(); runEvaluation(); });

const presetButtons = document.querySelectorAll('[data-preset]');
presetButtons.forEach(button => button.addEventListener('click', () => {
  const preset = button.dataset.preset;
  document.getElementById('studentName').value = 'Aarav Mehta';
  document.getElementById('dob').value = preset === 'age' ? '2015-04-18' : '2006-04-18';
  document.getElementById('apaar').value = preset === 'missing' ? '' : '123456789012';
  document.getElementById('admissionDate').value = '2025-08-12';
  document.getElementById('programme').value = 'Computer Science';
  document.getElementById('category').value = 'Regular';
  presetButtons.forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  runEvaluation();
}));
form.addEventListener('input', () => presetButtons.forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); }));

const scenarioButtons = document.querySelectorAll('[data-scenario]');
scenarioButtons.forEach(button => button.addEventListener('click', () => {
  const transfer = button.dataset.scenario === 'transfer';
  const paper = document.getElementById('timelinePaper');
  paper.classList.toggle('is-transfer', transfer);
  document.getElementById('firstPeriod').textContent = transfer ? 'Jul 2024 — Jun 2025' : 'Jul 2024 — active';
  document.getElementById('timelineTitle').textContent = transfer ? 'A verified release explains the transition' : 'Concurrent active periods';
  document.getElementById('timelineDetail').textContent = transfer ? 'Institution A records a verified June 2025 release. The new enrolment starts in July, after the previous period ends.' : 'Both records remain active after July 2025. A reviewer should establish the student’s enrolment status.';
  paper.querySelector('.verdict-icon').textContent = transfer ? '✓' : '!';
  scenarioButtons.forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
}));
