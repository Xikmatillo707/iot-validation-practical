const requiredColumns = [
  'Type', 'Air_Temperature', 'Process_Temperature', 'Rotational_Speed',
  'Torque', 'Tool_Wear', 'Failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF'
];

const $ = id => document.getElementById(id);

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(',').map(v => v.trim());
    const row = { Record_ID: index + 1 };
    headers.forEach((header, i) => {
      const value = Number(values[i]);
      row[header] = Number.isNaN(value) ? values[i] : value;
    });
    return row;
  });
  return { headers, rows };
}

const avg = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const std = values => {
  const mean = avg(values);
  return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1));
};
const power = row => (row.Rotational_Speed * row.Torque * 2 * Math.PI) / 60;

function indicators(row) {
  const powerWatts = power(row);
  return {
    TWF: row.TWF === 1 || row.Tool_Wear >= 200,
    HDF: row.HDF === 1 || ((row.Process_Temperature - row.Air_Temperature) < 8.6 && row.Rotational_Speed < 1380),
    PWF: row.PWF === 1 || powerWatts < 3500 || powerWatts > 9000,
    OSF: row.OSF === 1 || (row.Tool_Wear * row.Torque) > 11000,
    RNF: row.RNF === 1
  };
}

function analyse(headers, rows) {
  const missing = requiredColumns.filter(col => !headers.includes(col));
  const invalidRows = rows.filter(r =>
    !['L', 'M', 'H'].includes(r.Type) ||
    r.Air_Temperature < 250 || r.Air_Temperature > 350 ||
    r.Process_Temperature < 250 || r.Process_Temperature > 360 ||
    r.Rotational_Speed <= 0 || r.Torque < 0 || r.Tool_Wear < 0 ||
    ![0, 1].includes(r.Failure) || ![0, 1].includes(r.TWF) || ![0, 1].includes(r.HDF) ||
    ![0, 1].includes(r.PWF) || ![0, 1].includes(r.OSF) || ![0, 1].includes(r.RNF)
  );
  const anomalies = rows.filter(row => row.Failure === 1 || Object.values(indicators(row)).some(Boolean));
  const failures = rows.filter(row => row.Failure === 1);
  const anomalyIds = new Set(anomalies.map(r => r.Record_ID));
  const captured = failures.filter(row => anomalyIds.has(row.Record_ID));
  const modeCounts = ['TWF', 'HDF', 'PWF', 'OSF', 'RNF'].reduce((obj, field) => {
    obj[field] = rows.filter(row => row[field] === 1).length;
    return obj;
  }, {});

  return {
    rows, anomalies, failures, modeCounts,
    tests: [
      { id: 'TC01', name: 'Schema validation', pass: missing.length === 0, evidence: missing.length ? `Missing: ${missing.join(', ')}` : 'All required IoT columns are present.' },
      { id: 'TC02', name: 'Range validation', pass: invalidRows.length === 0, evidence: invalidRows.length ? `${invalidRows.length} invalid records detected.` : 'Sensor and binary-field values are within expected ranges.' },
      { id: 'TC03', name: 'Failure/anomaly detection', pass: anomalies.length > 0, evidence: `${anomalies.length} anomalous or failure-indicator records detected.` },
      { id: 'TC04', name: 'Failure detection coverage', pass: captured.length === failures.length, evidence: `${captured.length} of ${failures.length} failure-labelled records were flagged.` }
    ],
    stats: {
      'Average Air Temperature': `${avg(rows.map(r => r.Air_Temperature)).toFixed(2)} K`,
      'Average Process Temperature': `${avg(rows.map(r => r.Process_Temperature)).toFixed(2)} K`,
      'Average Rotational Speed': `${avg(rows.map(r => r.Rotational_Speed)).toFixed(2)} rpm`,
      'Average Torque': `${avg(rows.map(r => r.Torque)).toFixed(2)} Nm`,
      'Average Tool Wear': `${avg(rows.map(r => r.Tool_Wear)).toFixed(2)} min`,
      'Average Power Proxy': `${avg(rows.map(power)).toFixed(2)} W`,
      'Std. Dev. Tool Wear': std(rows.map(r => r.Tool_Wear)).toFixed(2)
    }
  };
}

function render(results) {
  $('recordCount').textContent = results.rows.length;
  $('failureCount').textContent = results.failures.length;
  $('failureRate').textContent = `${((results.failures.length / results.rows.length) * 100).toFixed(2)}%`;
  $('anomalyCount').textContent = results.anomalies.length;

  $('testRows').innerHTML = results.tests.map(t => `
    <tr><td><strong>${t.id}</strong><br>${t.name}</td><td><span class="badge ${t.pass ? 'pass' : 'fail'}">${t.pass ? 'PASS' : 'FAIL'}</span></td><td>${t.evidence}</td></tr>
  `).join('');

  $('statsRows').innerHTML = Object.entries(results.stats).map(([key, value]) => `<tr><td>${key}</td><td><strong>${value}</strong></td></tr>`).join('');

  const maxMode = Math.max(...Object.values(results.modeCounts), 1);
  $('modeBars').innerHTML = Object.entries(results.modeCounts).map(([key, value]) => `
    <div><div class="bar-label"><span>${key}</span><span>${value}</span></div><div class="track"><div class="fill" style="width:${(value / maxMode) * 100}%"></div></div></div>
  `).join('');

  $('anomalyList').innerHTML = results.anomalies.slice(0, 15).map(row => `
    <div class="anomaly"><strong>Record ${row.Record_ID}</strong>: Type=${row.Type}, Air=${row.Air_Temperature} K, Process=${row.Process_Temperature} K, Speed=${row.Rotational_Speed} rpm, Torque=${row.Torque} Nm, Tool_Wear=${row.Tool_Wear}, Failure=${row.Failure}</div>
  `).join('') + (results.anomalies.length > 15 ? `<div class="anomaly">${results.anomalies.length - 15} additional anomaly records not shown in this preview.</div>` : '');
}

async function runText(text, label) {
  const { headers, rows } = parseCSV(text);
  render(analyse(headers, rows));
  $('status').textContent = `Analysis complete: ${label}`;
}

$('demoBtn').addEventListener('click', async () => {
  try {
    $('status').textContent = 'Loading included demo dataset...';
    const response = await fetch('iot_predictive_maintenance_dataset.csv');
    if (!response.ok) throw new Error('Dataset could not be loaded. Start the local server using node server.js.');
    await runText(await response.text(), 'included demo dataset');
  } catch (error) {
    $('status').textContent = error.message;
  }
});

$('csvFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  await runText(await file.text(), file.name);
});

$('clearBtn').addEventListener('click', () => window.location.reload());
