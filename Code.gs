/**
 * ระบบทะเบียนหนังสือ (รับ-ส่ง + เรื่องร้องเรียน)
 * โครงสร้างชีต: สร้างชีตแยกอัตโนมัติตามปีงบประมาณ เช่น
 *   DATA70รับ, DATA70ส่ง  (ปีงบประมาณ 2570)
 *   DATA71รับ, DATA71ส่ง  (ปีงบประมาณ 2571)
 * เรื่องร้องเรียนใช้ชีตเดียวตลอดคือ DATAร้องเรียน (เลขคุมกรอกเอง)
 * และสามารถออกเลขหนังสือได้ โดยใช้เลขชุด 'ส่ง' ร่วมกับระบบเลขหนังสือปกติ
 * ปีงบประมาณ (พ.ศ.) เริ่มวันที่ 1 ตุลาคมของทุกปี และขึ้นเลขที่ 1 ใหม่ในแต่ละปี
 * (ยกเว้นค่าตั้งต้นที่กำหนดไว้ล่วงหน้าใน FISCAL_YEAR_NUMBER_OVERRIDES)
 */

const OLD_SHEET_NAME = 'DATA70';
const SHEET_COMPLAINT_NAME = 'DATAร้องเรียน';

const FOLDER_ID = '1Y0GV8T85zT688zTrEz8Nkh9-10HTnIzc';
const PREFIX_NUMBER = '(ศปน.ภ.3)/';

// ขนาดไฟล์แนบสูงสุด (เดิม 10 MB ปรับเป็น 25 MB)
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// รายการหน่วยงาน/ภ.จว. สำหรับตรวจสอบเบื้องต้น (ฝั่งไคลเอนต์เป็นตัวบังคับหลัก)
const AGENCY_OPTIONS = [
  'ชัยภูมิ',
  'นครราชสีมา',
  'บุรีรัมย์',
  'ยโสธร',
  'ศรีสะเกษ',
  'สุรินทร์',
  'อำนาจเจริญ',
  'อุบลราชธานี',
  'ศปน.ตร.',
  'ศปน.ภ.3'
];

// เลขที่หนังสือ "ตั้งต้น" ต่อปีงบประมาณ ใช้เป็นค่าพื้นล่าง (floor) ไม่ใช่ค่าบังคับตายตัว
// เช่น ปีงบประมาณ 2570 หนังสือส่ง กำหนดเลขตั้งต้น 294 -> รายการใหม่แรกจะได้ 295
const FISCAL_YEAR_NUMBER_OVERRIDES = {
  // ปีงบประมาณ 2569: เลขส่งเริ่ม 295 และเลขรับเริ่ม 99
  'รับ': { 2569: 98 },
  'ส่ง': { 2569: 294, 2570: 294 }
};

const HEADERS = [
  'วันที่บันทึก',
  'ประเภท',
  'เลขที่หนังสือ',
  'ลงวันที่',
  'เรื่อง',
  'หน่วยงาน/ภ.จว.',
  'ไฟล์แนบ',
  'หมายเหตุ',
  'สถานะ',
  'วันที่ยกเลิก',
  'เหตุผลการยกเลิก',
  'ปีงบประมาณ'
];

const HEADERS_COMPLAINT = HEADERS.map(function (header) {
  return header === 'เลขที่หนังสือ' ? 'เลขคุม' : header;
});

// คอลัมน์เพิ่มเติมเฉพาะเรื่องร้องเรียน สำหรับเลขหนังสือที่ออกตอบ/ดำเนินการ
const COMPLAINT_OUTGOING_NUMBER_HEADER = 'เลขที่หนังสือออก';

/**
 * Google Apps Script Web API
 *
 * Frontend อยู่บน GitHub Pages
 * Backend / Database / Drive อยู่บน Google Apps Script
 *
 * GET ใช้สำหรับอ่านข้อมูลด้วย JSONP
 * POST ใช้สำหรับงานเขียน โดยคืนผลไว้ใน CacheService ตาม requestId
 * เพื่อให้ GitHub Pages ไม่ต้องอ่าน response ของ POST ข้ามโดเมน
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || '').trim();

  try {
    let result;

    if (action === 'getHistory') {
      result = {
        success: true,
        data: getHistory()
      };
    } else if (action === 'getResult') {
      result = getApiResult_(params.requestId);
    } else {
      result = {
        success: true,
        service: 'ระบบทะเบียนหนังสือ API',
        version: 'github-api-1.0',
        message: 'Google Apps Script API พร้อมใช้งาน',
        actions: [
          'getHistory',
          'processForm',
          'updateRecord',
          'cancelRecord',
          'attachFile',
          'issueComplaintOutgoingNumber'
        ]
      };
    }

    return jsonOrJsonpResponse_(result, params.prefix);
  } catch (error) {
    return jsonOrJsonpResponse_({
      success: false,
      message: getErrorText_(error)
    }, params.prefix);
  }
}

/**
 * รับคำขอเขียนข้อมูลจาก GitHub Pages
 */
function doPost(e) {
  let requestId = '';

  try {
    const raw = e && e.postData && e.postData.contents
      ? e.postData.contents
      : '{}';

    const request = JSON.parse(raw);
    requestId = String(request.requestId || '').trim();

    if (!requestId) {
      throw new Error('ไม่พบ requestId');
    }

    const action = String(request.action || '').trim();
    const payload = request.payload || {};
    const data = routeApiAction_(action, payload);

    storeApiResult_(requestId, {
      ready: true,
      success: true,
      data: data
    });

    return jsonResponse_({
      accepted: true,
      requestId: requestId
    });
  } catch (error) {
    if (requestId) {
      storeApiResult_(requestId, {
        ready: true,
        success: false,
        message: getErrorText_(error)
      });
    }

    return jsonResponse_({
      accepted: !!requestId,
      success: false,
      requestId: requestId,
      message: getErrorText_(error)
    });
  }
}

/**
 * จ่ายงาน API ไปยังฟังก์ชันเดิมของระบบ
 */
function routeApiAction_(action, payload) {
  switch (action) {
    case 'processForm':
      return processForm(payload);

    case 'updateRecord':
      return updateRecord(payload);

    case 'cancelRecord':
      return cancelRecord(payload);

    case 'attachFile':
      return attachFile(payload);

    case 'issueComplaintOutgoingNumber':
      return issueComplaintOutgoingNumber(payload);

    default:
      throw new Error('ไม่รู้จัก API action: ' + action);
  }
}

function storeApiResult_(requestId, result) {
  const safeId = String(requestId || '').trim();

  if (!safeId || safeId.length > 200) {
    throw new Error('requestId ไม่ถูกต้อง');
  }

  CacheService
    .getScriptCache()
    .put(
      'apiResult_' + safeId,
      JSON.stringify(result),
      600
    );
}

function getApiResult_(requestId) {
  const safeId = String(requestId || '').trim();

  if (!safeId || safeId.length > 200) {
    return {
      ready: true,
      success: false,
      message: 'requestId ไม่ถูกต้อง'
    };
  }

  const value = CacheService
    .getScriptCache()
    .get('apiResult_' + safeId);

  if (!value) {
    return {
      ready: false
    };
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return {
      ready: true,
      success: false,
      message: 'อ่านผลลัพธ์ API ไม่สำเร็จ'
    };
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonOrJsonpResponse_(data, prefix) {
  const callback = String(prefix || '').trim();

  if (callback) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
      throw new Error('JSONP callback ไม่ถูกต้อง');
    }

    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(data) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return jsonResponse_(data);
}

/**
 * เพิ่มหนังสือรับ / หนังสือส่ง / เรื่องร้องเรียน
 */
function processForm(formObject) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    validateForm_(formObject);

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const docType = String(formObject.docType).trim();
    const fiscalYearBE = computeFiscalYearBE_(formObject.docDate);
    const sheetName = getSheetNameForType_(docType, fiscalYearBE);

    const sheet = getOrCreateSheet_(spreadsheet, sheetName, docType);

    let docNumber;
    let outgoingNumber = '';

    if (docType === 'ร้องเรียน') {
      docNumber = String(formObject.controlNumber || '').trim();
    } else {
      docNumber = generateDocumentNumber_(sheet, docType, fiscalYearBE);
    }

    const createdAt = new Date();

    let fileUrl = '';

    if (formObject.fileData) {
      fileUrl = uploadFile_(
        formObject.fileData,
        formObject.fileName,
        formObject.customFileName,
        docNumber,
        formObject.subject
      );
    }

    sheet.appendRow([
      createdAt,
      docType,
      docNumber,
      formObject.docDate,
      sanitizeCellValue_(formObject.subject),
      sanitizeCellValue_(formObject.party),
      fileUrl,
      sanitizeCellValue_(formObject.note || ''),
      'ใช้งาน',
      '',
      '',
      fiscalYearBE
    ]);

    const newRow = sheet.getLastRow();

    // หากผู้ใช้เลือกให้ออกเลขหนังสือพร้อมบันทึกเรื่องร้องเรียน
    if (docType === 'ร้องเรียน' && formObject.issueOutgoingNumber === true) {
      outgoingNumber = generateDocumentNumber_(
        getOrCreateSheet_(spreadsheet, getSheetNameForType_('ส่ง', fiscalYearBE), 'ส่ง'),
        'ส่ง',
        fiscalYearBE
      );
      ensureComplaintOutgoingColumn_(sheet);
      sheet.getRange(newRow, 13).setValue(outgoingNumber);
    }

    sheet
      .getRange(newRow, 1)
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');

    return {
      success: true,
      message: 'บันทึกรายการเรียบร้อยแล้ว',
      documentNumber: docNumber,
      outgoingNumber: outgoingNumber
    };
  } catch (error) {
    throw new Error(getErrorText_(error));
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // ไม่มีการทำงานเพิ่มเติม
    }
  }
}

/**
 * โหลดประวัติทั้งหมด (ทุกชีตปีงบประมาณ + ชีตเดิม + ชีตร้องเรียน)
 */
function getHistory() {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const records = [];

    const sheets = listRelevantSheets_(spreadsheet);

    sheets.forEach(function (sheet) {
      const sheetName = sheet.getName();

      if (sheet.getLastRow() < 2) {
        return;
      }

      const isCurrentSheet = sheetName !== OLD_SHEET_NAME;

      if (isCurrentSheet) {
        ensureStatusColumns_(sheet);
      }

      const lastRow = sheet.getLastRow();
      const columnCount = Math.max(
        Math.min(sheet.getLastColumn(), sheetName === SHEET_COMPLAINT_NAME ? 13 : 12),
        8
      );

      const rawValues = sheet
        .getRange(2, 1, lastRow - 1, columnCount)
        .getValues();

      const displayValues = sheet
        .getRange(2, 1, lastRow - 1, columnCount)
        .getDisplayValues();

      displayValues.forEach(function (row, index) {
        const actualRow = index + 2;
        const rawCreatedAt = rawValues[index][0];

        let sortTime = 0;

        if (
          rawCreatedAt &&
          Object.prototype.toString.call(rawCreatedAt) === '[object Date]'
        ) {
          sortTime = rawCreatedAt.getTime();
        } else {
          sortTime = actualRow;
        }

        const status = isCurrentSheet
          ? String(row[8] || 'ใช้งาน').trim()
          : 'ใช้งาน';

        records.push({
          createdAt: row[0] || '',
          type: normalizeType_(row[1], sheetName),
          documentNumber: row[2] || '',
          documentDate: row[3] || '',
          subject: row[4] || '',
          party: row[5] || '',
          fileUrl: row[6] || '',
          note: row[7] || '',
          status: status || 'ใช้งาน',
          cancelledAt: row[9] || '',
          cancelReason: row[10] || '',
          fiscalYear: row[11] || '',
          outgoingNumber: sheetName === SHEET_COMPLAINT_NAME ? (row[12] || '') : '',
          sheetName: sheetName,
          rowIndex: actualRow,
          canEdit: isCurrentSheet && status !== 'ยกเลิก',
          canCancel: isCurrentSheet && status !== 'ยกเลิก',
          sortTime: sortTime
        });
      });
    });

    records.sort(function (a, b) {
      return b.sortTime - a.sortTime;
    });

    return records.map(function (record) {
      delete record.sortTime;
      return record;
    });
  } catch (error) {
    throw new Error(
      'ไม่สามารถโหลดประวัติได้: ' + getErrorText_(error)
    );
  }
}

/**
 * แก้ไขหนังสือ / เรื่องร้องเรียน
 */
function updateRecord(dataObject) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const sheetName = String(dataObject.sheetName || '').trim();
    const rowIndex = Number(dataObject.rowIndex);

    validateEditableLocation_(sheetName, rowIndex);

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error('ไม่พบชีตที่ต้องการแก้ไข');
    }

    if (rowIndex > sheet.getLastRow()) {
      throw new Error('ไม่พบรายการที่ต้องการแก้ไข');
    }

    ensureStatusColumns_(sheet);

    const status = String(
      sheet.getRange(rowIndex, 9).getDisplayValue()
    ).trim();

    if (status === 'ยกเลิก') {
      throw new Error('ไม่สามารถแก้ไขหนังสือที่ยกเลิกแล้ว');
    }

    const subject = String(dataObject.subject || '').trim();
    const party = String(dataObject.party || '').trim();
    const note = String(dataObject.note || '').trim();

    if (!subject) {
      throw new Error('กรุณาระบุเรื่อง');
    }

    if (!party) {
      throw new Error('กรุณาระบุหน่วยงาน/ภ.จว.');
    }

    sheet
      .getRange(rowIndex, 5)
      .setValue(sanitizeCellValue_(subject));

    sheet
      .getRange(rowIndex, 6)
      .setValue(sanitizeCellValue_(party));

    sheet
      .getRange(rowIndex, 8)
      .setValue(sanitizeCellValue_(note));

    return {
      success: true,
      message: 'แก้ไขข้อมูลเรียบร้อยแล้ว'
    };
  } catch (error) {
    throw new Error(getErrorText_(error));
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // ไม่มีการทำงานเพิ่มเติม
    }
  }
}

/**
 * ยกเลิกหนังสือ/เรื่องร้องเรียนโดยไม่ลบข้อมูล
 */
function cancelRecord(dataObject) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const sheetName = String(dataObject.sheetName || '').trim();
    const rowIndex = Number(dataObject.rowIndex);
    const reason = String(dataObject.reason || '').trim();

    validateEditableLocation_(sheetName, rowIndex);

    if (!reason) {
      throw new Error('กรุณาระบุเหตุผลในการยกเลิก');
    }

    if (reason.length > 500) {
      throw new Error('เหตุผลการยกเลิกต้องไม่เกิน 500 ตัวอักษร');
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error('ไม่พบชีตที่ต้องการ');
    }

    if (rowIndex > sheet.getLastRow()) {
      throw new Error('ไม่พบรายการที่ต้องการยกเลิก');
    }

    ensureStatusColumns_(sheet);

    const currentStatus = String(
      sheet.getRange(rowIndex, 9).getDisplayValue()
    ).trim();

    if (currentStatus === 'ยกเลิก') {
      throw new Error('รายการนี้ถูกยกเลิกไปแล้ว');
    }

    sheet
      .getRange(rowIndex, 9, 1, 3)
      .setValues([[
        'ยกเลิก',
        new Date(),
        sanitizeCellValue_(reason)
      ]]);

    sheet
      .getRange(rowIndex, 10)
      .setNumberFormat('dd/MM/yyyy HH:mm:ss');

    return {
      success: true,
      message: 'ยกเลิกรายการเรียบร้อยแล้ว'
    };
  } catch (error) {
    throw new Error(getErrorText_(error));
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // ไม่มีการทำงานเพิ่มเติม
    }
  }
}

/**
 * ตรวจข้อมูลก่อนบันทึก
 */
function validateForm_(formObject) {
  if (!formObject) {
    throw new Error('ไม่พบข้อมูลที่ส่งมา');
  }

  const docType = String(formObject.docType || '').trim();
  const docDate = String(formObject.docDate || '').trim();
  const subject = String(formObject.subject || '').trim();
  const party = String(formObject.party || '').trim();

  if (!['รับ', 'ส่ง', 'ร้องเรียน'].includes(docType)) {
    throw new Error('ประเภทหนังสือไม่ถูกต้อง');
  }

  if (!docDate) {
    throw new Error('กรุณาระบุวันที่หนังสือ');
  }

  if (!subject) {
    throw new Error('กรุณาระบุเรื่อง');
  }

  if (!party) {
    throw new Error('กรุณาระบุหน่วยงาน/ภ.จว.');
  }

  if (subject.length > 1000) {
    throw new Error('ชื่อเรื่องยาวเกินไป');
  }

  if (party.length > 500) {
    throw new Error('ชื่อหน่วยงาน/ภ.จว. ยาวเกินไป');
  }

  if (docType === 'ร้องเรียน') {
    const controlNumber = String(formObject.controlNumber || '').trim();

    if (!controlNumber) {
      throw new Error('กรุณาระบุเลขคุม');
    }

    if (controlNumber.length > 100) {
      throw new Error('เลขคุมยาวเกินไป');
    }
  }
}

/**
 * คำนวณปีงบประมาณ (พ.ศ.) จากวันที่หนังสือ
 * 1 ต.ค. เป็นต้นไปของปี ค.ศ. ใดๆ จะขึ้นปีงบประมาณใหม่
 */
function computeFiscalYearBE_(dateLike) {
  const parsedDate =
    dateLike instanceof Date ? dateLike : new Date(dateLike);

  if (isNaN(parsedDate.getTime())) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }

  const month = parsedDate.getMonth() + 1; // 1-12
  const yearBE = parsedDate.getFullYear() + 543;

  return month >= 10 ? yearBE + 1 : yearBE;
}

/**
 * แปลงปีงบประมาณ พ.ศ. เต็ม เป็นส่วนท้าย 2 หลักของชื่อชีต เช่น 2570 -> '70'
 */
function getFiscalYearSuffix_(fiscalYearBE) {
  return String(fiscalYearBE % 100).padStart(2, '0');
}

/**
 * หาชื่อชีตปลายทางตามประเภทเอกสารและปีงบประมาณ
 */
function getSheetNameForType_(docType, fiscalYearBE) {
  if (docType === 'ร้องเรียน') {
    return SHEET_COMPLAINT_NAME;
  }

  const suffix = getFiscalYearSuffix_(fiscalYearBE);

  if (docType === 'รับ') {
    return 'DATA' + suffix + 'รับ';
  }

  if (docType === 'ส่ง') {
    return 'DATA' + suffix + 'ส่ง';
  }

  throw new Error('ประเภทหนังสือไม่ถูกต้อง');
}

/**
 * รวบรวมชีตที่เกี่ยวข้องทั้งหมด (ทุกปีงบประมาณ + ชีตเดิม + ชีตร้องเรียน)
 */
function listRelevantSheets_(spreadsheet) {
  const pattern = /^DATA\d{2}(รับ|ส่ง)$/;

  return spreadsheet.getSheets().filter(function (sheet) {
    const name = sheet.getName();
    return (
      pattern.test(name) ||
      name === OLD_SHEET_NAME ||
      name === SHEET_COMPLAINT_NAME
    );
  });
}

/**
 * สร้างชีตหรือเตรียมหัวตาราง
 */
function getOrCreateSheet_(spreadsheet, sheetName, docType) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  const headers = docType === 'ร้องเรียน' ? HEADERS_COMPLAINT : HEADERS;

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    sheet
      .getRange(1, 1, 1, headers.length)
      .setValues([headers]);

    formatHeader_(sheet);
  } else {
    ensureStatusColumns_(sheet);
  }

  return sheet;
}

/**
 * เพิ่มคอลัมน์สถานะ/ปีงบประมาณให้ข้อมูลเดิม โดยต่อท้ายตาราง ไม่ย้าย/ลบข้อมูลเดิม
 */
function ensureStatusColumns_(sheet) {
  const currentHeaders = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 12))
    .getDisplayValues()[0];

  const appendedHeaders = [
    'สถานะ',
    'วันที่ยกเลิก',
    'เหตุผลการยกเลิก',
    'ปีงบประมาณ'
  ];

  appendedHeaders.forEach(function (header, index) {
    const column = index + 9;

    if (!currentHeaders[column - 1]) {
      sheet.getRange(1, column).setValue(header);
    }
  });

  if (sheet.getName() === SHEET_COMPLAINT_NAME) {
    ensureComplaintOutgoingColumn_(sheet);
  }

  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const statusRange = sheet.getRange(2, 9, lastRow - 1, 1);
    const statuses = statusRange.getValues();
    let changed = false;

    statuses.forEach(function (row) {
      if (!row[0]) {
        row[0] = 'ใช้งาน';
        changed = true;
      }
    });

    if (changed) {
      statusRange.setValues(statuses);
    }
  }

  formatHeader_(sheet);
}

/**
 * เตรียมคอลัมน์เลขหนังสือออกสำหรับชีตร้องเรียน โดยไม่กระทบข้อมูลเดิม
 */
function ensureComplaintOutgoingColumn_(sheet) {
  if (sheet.getName() !== SHEET_COMPLAINT_NAME) return;

  const column = 13;
  const current = String(sheet.getRange(1, column).getDisplayValue() || '').trim();

  if (current !== COMPLAINT_OUTGOING_NUMBER_HEADER) {
    sheet.getRange(1, column).setValue(COMPLAINT_OUTGOING_NUMBER_HEADER);
  }
}

/**
 * จัดรูปแบบหัวตารางใน Google Sheets
 */
function formatHeader_(sheet) {
  sheet.setFrozenRows(1);

  sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 12))
    .setBackground('#176b5b')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(1, 36);
}

/**
 * สร้างเลขหนังสือถัดไป (แยกชุดเลขตามประเภท + ปีงบประมาณ โดยพิงชีตของปีงบประมาณนั้นๆ)
 */
function generateDocumentNumber_(sheet, docType, fiscalYearBE) {
  const lastRow = sheet.getLastRow();
  let maximumNumber = 0;

  if (lastRow >= 2) {
    const documentNumbers = sheet
      .getRange(2, 3, lastRow - 1, 1)
      .getDisplayValues()
      .flat();

    documentNumbers.forEach(function (value) {
      const text = String(value || '').trim();
      const matched = text.match(/(\d+)\s*$/);

      if (matched) {
        maximumNumber = Math.max(
          maximumNumber,
          Number(matched[1])
        );
      }
    });
  }

  // เลขหนังสือออกของเรื่องร้องเรียนใช้ชุดเลขเดียวกับ 'ส่ง'
  // จึงต้องนับเลขที่ถูกออกจากชีตร้องเรียนด้วย เพื่อไม่ให้เลขซ้ำ
  if (docType === 'ส่ง') {
    const complaintSheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(SHEET_COMPLAINT_NAME);

    if (complaintSheet) {
      ensureComplaintOutgoingColumn_(complaintSheet);
      const complaintLastRow = complaintSheet.getLastRow();

      if (complaintLastRow >= 2) {
        const outgoingNumbers = complaintSheet
          .getRange(2, 13, complaintLastRow - 1, 1)
          .getDisplayValues()
          .flat();

        outgoingNumbers.forEach(function (value) {
          const text = String(value || '').trim();
          const matched = text.match(/(\d+)\s*$/);

          if (matched) {
            maximumNumber = Math.max(
              maximumNumber,
              Number(matched[1])
            );
          }
        });
      }
    }
  }

  const overrideMap = FISCAL_YEAR_NUMBER_OVERRIDES[docType];
  const override = overrideMap ? overrideMap[fiscalYearBE] : null;

  if (override) {
    maximumNumber = Math.max(maximumNumber, override);
  }

  return PREFIX_NUMBER + (maximumNumber + 1);
}

/**
 * อัปโหลดไฟล์ไปยัง Google Drive
 */
function uploadFile_(
  fileData,
  originalFileName,
  customFileName,
  documentNumber,
  subject
) {
  const dataUrl = String(fileData || '');
  const matched = dataUrl.match(
    /^data:([^;]+);base64,(.+)$/
  );

  if (!matched) {
    throw new Error('รูปแบบไฟล์แนบไม่ถูกต้อง');
  }

  const mimeType = matched[1];
  const base64Data = matched[2];

  // จำกัดขนาดไฟล์ 25 MB (ปรับเพิ่มจากเดิม 10 MB)
  const estimatedBytes = Math.ceil(
    base64Data.length * 3 / 4
  );

  if (estimatedBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error('ไฟล์แนบต้องมีขนาดไม่เกิน 25 MB');
  }

  const originalName = String(
    originalFileName || 'attachment'
  );

  const extensionMatch = originalName.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : '';

  let baseName = String(customFileName || '').trim();

  if (!baseName) {
    baseName = documentNumber + '_' + String(subject || '');
  }

  baseName = sanitizeFileName_(baseName);

  if (!baseName) {
    baseName = 'document_' + Date.now();
  }

  if (
    extension &&
    !baseName.toLowerCase().endsWith(extension.toLowerCase())
  ) {
    baseName += extension;
  }

  const decoded = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(
    decoded,
    mimeType,
    baseName
  );

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const file = folder.createFile(blob);

  return file.getUrl();
}

/**
 * ออกเลขหนังสือให้เรื่องร้องเรียน โดยใช้เลขชุด 'ส่ง' ของปีงบประมาณเดียวกัน
 */
function issueComplaintOutgoingNumber(dataObject) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const sheetName = String(dataObject.sheetName || '').trim();
    const rowIndex = Number(dataObject.rowIndex);

    if (sheetName !== SHEET_COMPLAINT_NAME) {
      throw new Error('รายการนี้ไม่ใช่เรื่องร้องเรียน');
    }

    if (!Number.isInteger(rowIndex) || rowIndex < 2) {
      throw new Error('ตำแหน่งรายการไม่ถูกต้อง');
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const complaintSheet = spreadsheet.getSheetByName(SHEET_COMPLAINT_NAME);

    if (!complaintSheet || rowIndex > complaintSheet.getLastRow()) {
      throw new Error('ไม่พบรายการร้องเรียนที่ต้องการออกเลข');
    }

    ensureStatusColumns_(complaintSheet);
    ensureComplaintOutgoingColumn_(complaintSheet);

    const status = String(complaintSheet.getRange(rowIndex, 9).getDisplayValue()).trim();
    if (status === 'ยกเลิก') {
      throw new Error('ไม่สามารถออกเลขให้รายการที่ยกเลิกแล้ว');
    }

    const currentNumber = String(complaintSheet.getRange(rowIndex, 13).getDisplayValue()).trim();
    if (currentNumber) {
      return {
        success: true,
        message: 'รายการนี้มีเลขหนังสือออกแล้ว',
        documentNumber: currentNumber
      };
    }

    const fiscalYearBE = Number(complaintSheet.getRange(rowIndex, 12).getValue());
    if (!fiscalYearBE) {
      throw new Error('ไม่พบปีงบประมาณของเรื่องร้องเรียน');
    }

    const sendSheetName = getSheetNameForType_('ส่ง', fiscalYearBE);
    const sendSheet = getOrCreateSheet_(spreadsheet, sendSheetName, 'ส่ง');
    const documentNumber = generateDocumentNumber_(sendSheet, 'ส่ง', fiscalYearBE);

    complaintSheet.getRange(rowIndex, 13).setValue(documentNumber);

    return {
      success: true,
      message: 'ออกเลขหนังสือเรียบร้อยแล้ว',
      documentNumber: documentNumber
    };
  } catch (error) {
    throw new Error(getErrorText_(error));
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {}
  }
}

/**
 * ตรวจสอบชีตและแถวที่อนุญาตให้แก้ไข/ยกเลิก (ทุกชีตปีงบประมาณ + ชีตร้องเรียน)
 */
function validateEditableLocation_(sheetName, rowIndex) {
  const pattern = /^DATA\d{2}(รับ|ส่ง)$/;
  const allowed =
    pattern.test(sheetName) || sheetName === SHEET_COMPLAINT_NAME;

  if (!allowed) {
    throw new Error('ไม่อนุญาตให้ดำเนินการกับรายการนี้');
  }

  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < 2
  ) {
    throw new Error('ตำแหน่งรายการไม่ถูกต้อง');
  }
}

/**
 * แนบไฟล์เพิ่มเติมภายหลังจากออกเลขแล้ว
 */
function attachFile(dataObject) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const sheetName = String(dataObject.sheetName || '').trim();
    const rowIndex = Number(dataObject.rowIndex);

    validateEditableLocation_(sheetName, rowIndex);

    if (!dataObject.fileData) {
      throw new Error('กรุณาเลือกไฟล์');
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet || rowIndex > sheet.getLastRow()) {
      throw new Error('ไม่พบรายการที่ต้องการแนบไฟล์');
    }

    ensureStatusColumns_(sheet);

    const status = String(sheet.getRange(rowIndex, 9).getDisplayValue()).trim();
    if (status === 'ยกเลิก') {
      throw new Error('ไม่สามารถแนบไฟล์ให้รายการที่ยกเลิกแล้ว');
    }

    const documentNumber = String(sheet.getRange(rowIndex, 3).getDisplayValue()).trim();
    const subject = String(sheet.getRange(rowIndex, 5).getDisplayValue()).trim();
    const fileUrl = uploadFile_(
      dataObject.fileData,
      dataObject.fileName,
      dataObject.customFileName,
      documentNumber,
      subject
    );

    sheet.getRange(rowIndex, 7).setValue(fileUrl);

    return {
      success: true,
      message: 'แนบไฟล์เรียบร้อยแล้ว'
    };
  } catch (error) {
    throw new Error(getErrorText_(error));
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // ไม่มีการทำงานเพิ่มเติม
    }
  }
}

/**
 * ตรวจสอบประเภทจากชื่อชีต
 */
function normalizeType_(storedType, sheetName) {
  if (sheetName === SHEET_COMPLAINT_NAME) {
    return 'ร้องเรียน';
  }

  if (/^DATA\d{2}รับ$/.test(sheetName)) {
    return 'รับ';
  }

  if (/^DATA\d{2}ส่ง$/.test(sheetName)) {
    return 'ส่ง';
  }

  const value = String(storedType || '');

  if (value.includes('รับ')) {
    return 'รับ';
  }

  if (value.includes('ส่ง')) {
    return 'ส่ง';
  }

  if (value.includes('ร้องเรียน')) {
    return 'ร้องเรียน';
  }

  return 'ข้อมูลเดิม';
}

/**
 * ป้องกันข้อความถูกตีความเป็นสูตรใน Google Sheets
 */
function sanitizeCellValue_(value) {
  const text = String(value == null ? '' : value);

  if (/^[=+\-@]/.test(text)) {
    return "'" + text;
  }

  return text;
}

/**
 * ทำความสะอาดชื่อไฟล์
 */
function sanitizeFileName_(fileName) {
  return String(fileName || '')
    .replace(/[\\/:*?"<>|#%{}~&]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 180);
}

/**
 * แปลงข้อความข้อผิดพลาด
 */
function getErrorText_(error) {
  if (!error) {
    return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  }

  return error.message || String(error);
}
