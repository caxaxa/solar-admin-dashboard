/**
 * IV Data Review — parse IV data files (CSV or PVAPX) and return structured data for admin review.
 *
 * GET /iv/projects/{orgId}/{projectId}/data-review?env=dev|prod
 *   Lists all data files in the IV uploads bucket, parses CSV or PVAPX/ZIP content,
 *   and extracts measurement data for each string.
 */
const AdmZip = require('adm-zip');
const { s3 } = require('../shared/aws-clients');
const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv, getIVBucketConfig } = require('../shared/env');

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

/**
 * Parse a single IV CSV file content and extract measurement rows.
 */
function parseIVCsv(csvContent, filename) {
  const rows = [];
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return rows;

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

  const col = (name) => {
    const variants = Array.isArray(name) ? name : [name];
    for (const v of variants) {
      const idx = headers.findIndex((h) => h.includes(v.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxStringId = col(['array location', 'string id', 'string', 'location']);
  const idxDateTime = col(['report date', 'date/time', 'datetime', 'date']);
  const idxPmax = col(['pmax']);
  const idxVoc = col(['voc']);
  const idxIsc = col(['isc']);
  const idxFillFactor = col(['fill factor', 'ff']);
  const idxPF = col(['performance factor', 'pf']);
  const idxIrradiance = col(['irradiance']);
  const idxTemp = col(['temperature', 'cell temp', 'temp']);

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length < 2) continue;

    const pf = idxPF !== -1 ? parseFloat(vals[idxPF]) : null;
    const ff = idxFillFactor !== -1 ? parseFloat(vals[idxFillFactor]) : null;

    rows.push({
      stringId: idxStringId !== -1 ? vals[idxStringId] : `Row ${i}`,
      dateTime: idxDateTime !== -1 ? vals[idxDateTime] : '',
      pmax: idxPmax !== -1 ? parseFloat(vals[idxPmax]) || null : null,
      voc: idxVoc !== -1 ? parseFloat(vals[idxVoc]) || null : null,
      isc: idxIsc !== -1 ? parseFloat(vals[idxIsc]) || null : null,
      fillFactor: isNaN(ff) ? null : ff,
      performanceFactor: isNaN(pf) ? null : pf,
      irradiance: idxIrradiance !== -1 ? parseFloat(vals[idxIrradiance]) || null : null,
      cellTemp: idxTemp !== -1 ? parseFloat(vals[idxTemp]) || null : null,
      sourceFile: filename,
    });
  }

  return rows;
}

/**
 * Extract text content of an XML element by tag name.
 * Simple regex-based parser — no need for a full XML library.
 */
function xmlText(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse a float from XML element text; return null if missing or NaN.
 */
function xmlFloat(xml, tag) {
  const text = xmlText(xml, tag);
  if (text == null) return null;
  const val = parseFloat(text);
  return isNaN(val) ? null : val;
}

/**
 * Convert Kelvin to Celsius (pvapx thermocouple readings are in Kelvin).
 */
function kelvinToCelsius(k) {
  if (k == null) return null;
  // Values below 200 are likely already in Celsius
  if (k < 200) return k;
  return Math.round((k - 273.15) * 100) / 100;
}

/**
 * Parse a single PVAPX measurement XML entry (TraceData1500 format).
 */
function parsePvapxMeasurement(xmlContent, entryName, filename) {
  const pmax = xmlFloat(xmlContent, 'MeasuredPmax');
  const voc = xmlFloat(xmlContent, 'MeasuredVoc');
  const isc = xmlFloat(xmlContent, 'MeasuredIsc');
  const vmpp = xmlFloat(xmlContent, 'MeasuredVmpp');
  const impp = xmlFloat(xmlContent, 'MeasuredImpp');
  const predictedPmax = xmlFloat(xmlContent, 'PredictedPmax');
  const irradiance = xmlFloat(xmlContent, 'MeasuredIrradiance') || xmlFloat(xmlContent, 'ManualIrradiance');

  // Temperature: try thermocouple readings (Kelvin), then predicted/manual PV temp
  let cellTemp = null;
  const tc2 = xmlFloat(xmlContent, 'MeasuredThermocouple2');
  const tc1 = xmlFloat(xmlContent, 'MeasuredThermocouple1');
  const predictedTemp = xmlFloat(xmlContent, 'PredictedPvTemperature');
  const manualTemp = xmlFloat(xmlContent, 'ManualPvTemperature');
  const rawTemp = tc2 || tc1 || predictedTemp || manualTemp;
  cellTemp = kelvinToCelsius(rawTemp);

  // DateTime
  const dateTime = xmlText(xmlContent, 'DateTime') || '';

  // Performance ratio from XML
  const performanceFactor = xmlFloat(xmlContent, 'PerformanceRatio');

  // Fill Factor: compute as (Vmpp * Impp) / (Voc * Isc) * 100
  let fillFactor = null;
  if (vmpp && impp && voc && isc && voc !== 0 && isc !== 0) {
    fillFactor = Math.round(((vmpp * impp) / (voc * isc)) * 10000) / 100;
  }

  // Use the measurement entry name as stringId (e.g. "meas/20230714113950")
  const stringId = entryName.replace(/^meas\//, '');

  return {
    stringId,
    dateTime,
    pmax: pmax != null ? Math.round(pmax * 100) / 100 : null,
    voc: voc != null ? Math.round(voc * 100) / 100 : null,
    isc: isc != null ? Math.round(isc * 100) / 100 : null,
    vmpp: vmpp != null ? Math.round(vmpp * 100) / 100 : null,
    impp: impp != null ? Math.round(impp * 100) / 100 : null,
    fillFactor,
    performanceFactor,
    irradiance: irradiance != null ? Math.round(irradiance * 100) / 100 : null,
    cellTemp,
    predictedPmax: predictedPmax != null ? Math.round(predictedPmax * 100) / 100 : null,
    sourceFile: filename,
  };
}

/**
 * Parse module specification from setting9.xml inside the PVAPX.
 */
function parseModuleSpec(xmlContent) {
  if (!xmlContent) return null;

  const manufacturer = xmlText(xmlContent, 'Manufacturer');
  const model = xmlText(xmlContent, 'ModelNumber') || xmlText(xmlContent, 'Model');
  const ratedPmax = xmlFloat(xmlContent, 'Pmax');
  const ratedVoc = xmlFloat(xmlContent, 'Voc');
  const ratedIsc = xmlFloat(xmlContent, 'Isc');
  const numCells = xmlFloat(xmlContent, 'NumberOfCells');
  const technology = xmlText(xmlContent, 'Technology');

  if (!manufacturer && !model && !ratedPmax) return null;

  return {
    manufacturer,
    model,
    ratedPmax,
    ratedVoc,
    ratedIsc,
    numCells,
    technology,
  };
}

/**
 * Parse a PVAPX/ZIP file buffer and return measurement rows + module spec.
 */
function parsePvapxZip(buffer, filename) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const measurements = [];
  let moduleSpec = null;

  for (const entry of entries) {
    const name = entry.entryName;

    // Parse setting9.xml for module specification
    if (/setting9\.xml$/i.test(name) && !entry.isDirectory) {
      try {
        const content = entry.getData().toString('utf-8');
        moduleSpec = parseModuleSpec(content);
      } catch (err) {
        console.warn(`Failed to parse settings from ${name}:`, err.message);
      }
      continue;
    }

    // Parse measurement entries (files under meas/ directory)
    if (/^meas\//i.test(name) && !entry.isDirectory) {
      try {
        const content = entry.getData().toString('utf-8');
        // Only parse if it looks like XML with TraceData
        if (content.includes('TraceData') || content.includes('MeasuredPmax')) {
          const row = parsePvapxMeasurement(content, name, filename);
          if (row.pmax != null || row.voc != null) {
            measurements.push(row);
          }
        }
      } catch (err) {
        console.warn(`Failed to parse measurement ${name}:`, err.message);
      }
    }
  }

  // Sort by dateTime
  measurements.sort((a, b) => (a.dateTime || '').localeCompare(b.dateTime || ''));

  return { measurements, moduleSpec };
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return preflightResponse();
  if (method !== 'GET') return errorResponse(405, 'Method not allowed');

  try {
    const { orgId, projectId } = getPathParams(event);
    if (!orgId || !projectId) {
      return errorResponse(400, 'Missing orgId or projectId');
    }

    const env = normalizeEnv(event.queryStringParameters?.env);
    const { uploadsBucket } = getIVBucketConfig(env);

    if (!uploadsBucket) {
      return errorResponse(500, 'IV bucket configuration missing');
    }

    const dataPrefix = `${orgId}/projects/${projectId}/data/`;

    // List all data files
    const listResult = await s3
      .listObjectsV2({ Bucket: uploadsBucket, Prefix: dataPrefix })
      .promise();

    const allKeys = (listResult.Contents || [])
      .map((obj) => obj.Key)
      .sort();

    // Separate CSV vs ZIP/PVAPX files
    const csvKeys = allKeys.filter((key) => /\.csv$/i.test(key));
    const zipKeys = allKeys.filter((key) => /\.(pvapx|pvapx\.zip|zip)$/i.test(key));

    if (csvKeys.length === 0 && zipKeys.length === 0) {
      return jsonResponse(200, { measurements: [], totalFiles: 0 });
    }

    const allMeasurements = [];
    let moduleSpec = null;

    // Parse CSV files
    for (const key of csvKeys) {
      try {
        const obj = await s3
          .getObject({ Bucket: uploadsBucket, Key: key })
          .promise();
        const content = obj.Body.toString('utf-8');
        const filename = key.split('/').pop();
        const rows = parseIVCsv(content, filename);
        allMeasurements.push(...rows);
      } catch (err) {
        console.warn(`Failed to parse CSV ${key}:`, err.message);
      }
    }

    // Parse PVAPX/ZIP files
    for (const key of zipKeys) {
      try {
        const obj = await s3
          .getObject({ Bucket: uploadsBucket, Key: key })
          .promise();
        const filename = key.split('/').pop();
        const result = parsePvapxZip(obj.Body, filename);
        allMeasurements.push(...result.measurements);
        if (result.moduleSpec && !moduleSpec) {
          moduleSpec = result.moduleSpec;
        }
      } catch (err) {
        console.warn(`Failed to parse PVAPX/ZIP ${key}:`, err.message);
      }
    }

    return jsonResponse(200, {
      measurements: allMeasurements,
      totalFiles: csvKeys.length + zipKeys.length,
      moduleSpec,
    });
  } catch (error) {
    console.error('Failed to fetch IV data review', error);
    return errorResponse(500, 'Failed to fetch IV data review');
  }
};
