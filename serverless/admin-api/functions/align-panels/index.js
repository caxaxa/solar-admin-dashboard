/**
 * Panel alignment Lambda function for the annotation tool.
 *
 * This implements the same PCA-based alignment algorithm as detection_postprocessor.py:
 * 1. Standardize panel sizes to median dimensions
 * 2. Deduplicate overlapping panels using IoU
 * 3. Align panels to grid (vertical ladders for horizontal panels, horizontal ladders for vertical)
 * 4. Eliminate overlaps between aligned panels
 */

const { jsonResponse, errorResponse, preflightResponse, setRequestEvent } = require('../shared/http');
const { normalizeEnv } = require('../shared/env');

// Label normalization maps various labels to canonical names
const LABEL_NORMALIZATION = {
  default_panel: 'default_panel',
  solarpanels: 'default_panel',
  solar_panel: 'default_panel',
  panel: 'default_panel',
  hotspot: 'hotspots',
  hotspots: 'hotspots',
  faultydiodes: 'faultydiodes',
  faulty_diode: 'faultydiodes',
  offlinepanels: 'offlinepanels',
  offline_panel: 'offlinepanels',
};

function getPathParams(event) {
  const params = event.pathParameters || {};
  return {
    orgId: params.orgId,
    projectId: params.projectId,
  };
}

function parseBody(event) {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(val, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function calculateMedianPanelSize(detections) {
  const panels = detections.filter(d => d.class === 'default_panel');
  if (!panels.length) return { medianWidth: null, medianHeight: null };

  const widths = panels.map(d => d.bbox[2] - d.bbox[0]);
  const heights = panels.map(d => d.bbox[3] - d.bbox[1]);

  return {
    medianWidth: median(widths),
    medianHeight: median(heights),
  };
}

function standardizePanelSize(detection, medianWidth, medianHeight) {
  const bbox = detection.bbox;
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;

  detection.bbox = [
    round(cx - medianWidth / 2),
    round(cy - medianHeight / 2),
    round(cx + medianWidth / 2),
    round(cy + medianHeight / 2),
  ];

  return detection;
}

function calculateIoU(box1, box2) {
  const [x1Min, y1Min, x1Max, y1Max] = box1;
  const [x2Min, y2Min, x2Max, y2Max] = box2;

  const xInterMin = Math.max(x1Min, x2Min);
  const yInterMin = Math.max(y1Min, y2Min);
  const xInterMax = Math.min(x1Max, x2Max);
  const yInterMax = Math.min(y1Max, y2Max);

  if (xInterMax < xInterMin || yInterMax < yInterMin) return 0;

  const interArea = (xInterMax - xInterMin) * (yInterMax - yInterMin);
  const box1Area = (x1Max - x1Min) * (y1Max - y1Min);
  const box2Area = (x2Max - x2Min) * (y2Max - y2Min);
  const unionArea = box1Area + box2Area - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function mergeDuplicateDetections(detections, iouThreshold = 0.2) {
  if (!detections.length) return [];

  // Group by class
  const grouped = {};
  for (const det of detections) {
    if (!grouped[det.class]) grouped[det.class] = [];
    grouped[det.class].push(det);
  }

  const mergedResults = [];

  for (const cls of Object.keys(grouped)) {
    let classDetections = [...grouped[cls]].sort(
      (a, b) => (b.confidence || 0) - (a.confidence || 0)
    );

    while (classDetections.length) {
      const current = classDetections.shift();
      const overlapping = [current];
      const remaining = [];

      for (const det of classDetections) {
        if (calculateIoU(current.bbox, det.bbox) >= iouThreshold) {
          overlapping.push(det);
        } else {
          remaining.push(det);
        }
      }

      if (overlapping.length > 1) {
        const centersX = overlapping.map(d => (d.bbox[0] + d.bbox[2]) / 2);
        const centersY = overlapping.map(d => (d.bbox[1] + d.bbox[3]) / 2);
        const confidences = overlapping.map(d => d.confidence || 0);

        const avgCx = centersX.reduce((a, b) => a + b, 0) / centersX.length;
        const avgCy = centersY.reduce((a, b) => a + b, 0) / centersY.length;
        const maxConf = Math.max(...confidences);
        const width = current.bbox[2] - current.bbox[0];
        const height = current.bbox[3] - current.bbox[1];

        mergedResults.push({
          class: cls,
          confidence: round(maxConf, 4),
          bbox: [
            round(avgCx - width / 2),
            round(avgCy - height / 2),
            round(avgCx + width / 2),
            round(avgCy + height / 2),
          ],
        });
      } else {
        mergedResults.push(current);
      }

      classDetections = remaining;
    }
  }

  return mergedResults;
}

function clusterByXCoordinate(panels, tolerance) {
  const sorted = [...panels].sort((a, b) => {
    const centerA = (a.bbox[0] + a.bbox[2]) / 2;
    const centerB = (b.bbox[0] + b.bbox[2]) / 2;
    return centerA - centerB;
  });

  const columns = [];
  let currentColumn = [];

  for (const panel of sorted) {
    const centerX = (panel.bbox[0] + panel.bbox[2]) / 2;
    if (!currentColumn.length) {
      currentColumn.push(panel);
      continue;
    }

    const columnCenter = median(currentColumn.map(p => (p.bbox[0] + p.bbox[2]) / 2));
    if (Math.abs(centerX - columnCenter) < tolerance) {
      currentColumn.push(panel);
    } else {
      columns.push(currentColumn);
      currentColumn = [panel];
    }
  }

  if (currentColumn.length) {
    columns.push(currentColumn);
  }

  return columns;
}

function clusterByYCoordinate(panels, tolerance) {
  const sorted = [...panels].sort((a, b) => {
    const centerA = (a.bbox[1] + a.bbox[3]) / 2;
    const centerB = (b.bbox[1] + b.bbox[3]) / 2;
    return centerA - centerB;
  });

  const rows = [];
  let currentRow = [];

  for (const panel of sorted) {
    const centerY = (panel.bbox[1] + panel.bbox[3]) / 2;
    if (!currentRow.length) {
      currentRow.push(panel);
      continue;
    }

    const rowCenter = median(currentRow.map(p => (p.bbox[1] + p.bbox[3]) / 2));
    if (Math.abs(centerY - rowCenter) < tolerance) {
      currentRow.push(panel);
    } else {
      rows.push(currentRow);
      currentRow = [panel];
    }
  }

  if (currentRow.length) {
    rows.push(currentRow);
  }

  return rows;
}

function alignVerticalLadders(panels, panelWidth, panelHeight) {
  const columns = clusterByXCoordinate(panels, panelWidth * 0.5);
  const alignedPanels = [];

  for (const column of columns) {
    const centersX = column.map(p => (p.bbox[0] + p.bbox[2]) / 2);
    const medianX = median(centersX);
    const x1Col = round(medianX - panelWidth / 2);
    const x2Col = round(medianX + panelWidth / 2);

    for (const panel of column) {
      panel.bbox[0] = x1Col;
      panel.bbox[2] = x2Col;
    }

    column.sort((a, b) => a.bbox[1] - b.bbox[1]);

    if (column.length > 1) {
      const gaps = [];
      for (let i = 0; i < column.length - 1; i++) {
        gaps.push(column[i + 1].bbox[1] - column[i].bbox[3]);
      }
      const medianGap = median(gaps);

      for (let i = 1; i < column.length; i++) {
        const prev = column[i - 1];
        const curr = column[i];
        const expectedY1 = prev.bbox[3] + medianGap;

        if (curr.bbox[1] < prev.bbox[3]) {
          curr.bbox[1] = expectedY1;
          curr.bbox[3] = expectedY1 + panelHeight;
        } else if (Math.abs(curr.bbox[1] - expectedY1) <= panelHeight * 0.3) {
          curr.bbox[1] = expectedY1;
          curr.bbox[3] = expectedY1 + panelHeight;
        }
      }
    }

    alignedPanels.push(...column);
  }

  return alignedPanels;
}

function alignHorizontalLadders(panels, panelWidth, panelHeight) {
  const rows = clusterByYCoordinate(panels, panelHeight * 0.5);
  const alignedPanels = [];

  for (const row of rows) {
    const centersY = row.map(p => (p.bbox[1] + p.bbox[3]) / 2);
    const medianY = median(centersY);
    const y1Row = round(medianY - panelHeight / 2);
    const y2Row = round(medianY + panelHeight / 2);

    for (const panel of row) {
      panel.bbox[1] = y1Row;
      panel.bbox[3] = y2Row;
    }

    row.sort((a, b) => a.bbox[0] - b.bbox[0]);

    if (row.length > 1) {
      const gaps = [];
      for (let i = 0; i < row.length - 1; i++) {
        gaps.push(row[i + 1].bbox[0] - row[i].bbox[2]);
      }
      const medianGap = median(gaps);

      for (let i = 1; i < row.length; i++) {
        const prev = row[i - 1];
        const curr = row[i];
        const expectedX1 = prev.bbox[2] + medianGap;

        if (curr.bbox[0] < prev.bbox[2]) {
          curr.bbox[0] = expectedX1;
          curr.bbox[2] = expectedX1 + panelWidth;
        } else if (Math.abs(curr.bbox[0] - expectedX1) <= panelWidth * 0.3) {
          curr.bbox[0] = expectedX1;
          curr.bbox[2] = expectedX1 + panelWidth;
        }
      }
    }

    alignedPanels.push(...row);
  }

  return alignedPanels;
}

function eliminateOverlapsAndRenormalize(panels, orientation) {
  if (!panels.length) return panels;

  if (orientation === 'HORIZONTAL') {
    const panelWidth = panels[0].bbox[2] - panels[0].bbox[0];
    const columns = clusterByXCoordinate(panels, panelWidth * 0.5);

    const nonOverlappingPanels = [];
    for (const col of columns) {
      col.sort((a, b) => a.bbox[1] - b.bbox[1]);
      for (let i = 1; i < col.length; i++) {
        const prev = col[i - 1];
        const curr = col[i];
        const prevBottom = prev.bbox[3];
        const currTop = curr.bbox[1];
        if (currTop < prevBottom) {
          const overlap = prevBottom - currTop;
          const halfOverlap = overlap / 2;
          prev.bbox[3] = prevBottom - halfOverlap;
          curr.bbox[1] = currTop + halfOverlap;
        }
      }
      nonOverlappingPanels.push(...col);
    }
    return nonOverlappingPanels;
  }

  // VERTICAL orientation
  const panelHeight = panels[0].bbox[3] - panels[0].bbox[1];
  const rows = clusterByYCoordinate(panels, panelHeight * 0.5);

  const nonOverlappingPanels = [];
  for (const row of rows) {
    row.sort((a, b) => a.bbox[0] - b.bbox[0]);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1];
      const curr = row[i];
      const prevRight = prev.bbox[2];
      const currLeft = curr.bbox[0];
      if (currLeft < prevRight) {
        const overlap = prevRight - currLeft;
        const halfOverlap = overlap / 2;
        prev.bbox[2] = prevRight - halfOverlap;
        curr.bbox[0] = currLeft + halfOverlap;
      }
    }
    nonOverlappingPanels.push(...row);
  }

  return nonOverlappingPanels;
}

function alignPanelsToGrid(detections, panelWidth, panelHeight) {
  const panels = detections.filter(d => d.class === 'default_panel');
  const otherDetections = detections.filter(d => d.class !== 'default_panel');

  if (panels.length < 3) {
    return detections;
  }

  const orientation = panelWidth > panelHeight ? 'HORIZONTAL' : 'VERTICAL';
  let alignedPanels;

  if (orientation === 'HORIZONTAL') {
    alignedPanels = alignVerticalLadders(panels, panelWidth, panelHeight);
  } else {
    alignedPanels = alignHorizontalLadders(panels, panelWidth, panelHeight);
  }

  alignedPanels = eliminateOverlapsAndRenormalize(alignedPanels, orientation);

  return [...alignedPanels, ...otherDetections];
}

function standardizeAndDeduplicate(detections, iouThreshold = 0.2) {
  if (!detections.length) return [];

  const { medianWidth, medianHeight } = calculateMedianPanelSize(detections);

  // Standardize panel sizes
  const standardized = detections.map(det => {
    if (det.class === 'default_panel' && medianWidth && medianHeight) {
      return standardizePanelSize({ ...det, bbox: [...det.bbox] }, medianWidth, medianHeight);
    }
    return { ...det, bbox: [...det.bbox] };
  });

  // Deduplicate
  const deduplicated = mergeDuplicateDetections(standardized, iouThreshold);

  // Align to grid
  if (medianWidth && medianHeight) {
    return alignPanelsToGrid(deduplicated, medianWidth, medianHeight);
  }

  return deduplicated;
}

exports.handler = async (event) => {
  setRequestEvent(event);
  const method = event.requestContext?.http?.method || 'POST';
  if (method === 'OPTIONS') {
    return preflightResponse();
  }

  const { orgId, projectId } = getPathParams(event);
  if (!orgId || !projectId) {
    return errorResponse(400, 'Missing orgId or projectId');
  }

  if (method !== 'POST') {
    return errorResponse(405, 'Method not allowed');
  }

  try {
    const body = parseBody(event);
    if (!body || !Array.isArray(body.boundingBoxes)) {
      return errorResponse(400, 'Invalid request body: boundingBoxes must be an array');
    }

    console.log(`Aligning ${body.boundingBoxes.length} panels for project ${projectId}`);

    // Convert input format to detection format
    const detections = [];
    for (const box of body.boundingBoxes) {
      const label = (box.label || 'default_panel').toLowerCase();
      const normalizedLabel = LABEL_NORMALIZATION[label] || label;

      const left = parseFloat(box.left) || 0;
      const top = parseFloat(box.top) || 0;
      const width = parseFloat(box.width) || 0;
      const height = parseFloat(box.height) || 0;

      if (width <= 0 || height <= 0) continue;

      detections.push({
        class: normalizedLabel,
        confidence: parseFloat(box.confidence) || 0.99,
        bbox: [left, top, left + width, top + height],
      });
    }

    // Run alignment
    const aligned = standardizeAndDeduplicate(detections, 0.2);

    // Convert back to frontend format
    const alignedBoxes = aligned.map(det => ({
      left: round(det.bbox[0]),
      top: round(det.bbox[1]),
      width: round(det.bbox[2] - det.bbox[0]),
      height: round(det.bbox[3] - det.bbox[1]),
      label: det.class === 'default_panel' ? 'default_panel' : det.class,
    }));

    // Calculate stats
    const panelCount = alignedBoxes.filter(b => b.label === 'default_panel').length;
    const { medianWidth, medianHeight } = calculateMedianPanelSize(detections);

    console.log(`Alignment complete: ${alignedBoxes.length} boxes, median size ${medianWidth?.toFixed(1)}x${medianHeight?.toFixed(1)}`);

    return jsonResponse(200, {
      aligned_boxes: alignedBoxes,
      stats: {
        total_aligned: alignedBoxes.length,
        input_count: body.boundingBoxes.length,
        panel_count: panelCount,
        median_width: medianWidth ? round(medianWidth) : null,
        median_height: medianHeight ? round(medianHeight) : null,
      },
    });
  } catch (error) {
    console.error('Alignment failed', error);
    return errorResponse(500, 'Panel alignment failed', error.message);
  }
};
