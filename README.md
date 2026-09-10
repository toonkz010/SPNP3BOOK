# ระบบทะเบียนหนังสือ — GitHub Pages + Google Apps Script API

เวอร์ชันนี้แยกส่วนระบบออกเป็น 2 ฝั่ง:

- **GitHub Pages** — หน้าเว็บ `index.html`
- **Google Apps Script** — API + Google Sheets + Google Drive (`Code.gs`)

ข้อมูลยังเก็บใน Google Sheets และไฟล์แนบยังเก็บใน Google Drive เหมือนเดิม

## 1) อัปโหลด Code.gs เข้า Apps Script

เปิดโปรเจกต์ Google Apps Script ที่ผูกกับ Google Sheet เดิม แล้วแทนที่ `Code.gs` ด้วยไฟล์ `Code.gs` ในโฟลเดอร์นี้

ไม่ต้องสร้าง `Index.html` ใน Apps Script สำหรับเวอร์ชัน GitHub

## 2) Deploy Google Apps Script เป็น Web App

ใน Apps Script:

1. กด **Deploy** → **New deployment**
2. เลือกประเภท **Web app**
3. ตั้ง **Execute as** = **Me** (เจ้าของสคริปต์)
4. ตั้งสิทธิ์การเข้าถึงให้ผู้ใช้ที่ต้องการใช้งานเข้าถึง Web App ได้
5. กด Deploy
6. คัดลอก URL ที่ลงท้ายด้วย `/exec`

ตัวอย่าง:

`https://script.google.com/macros/s/XXXXXXXXXXXX/exec`

## 3) ใส่ API URL ใน index.html

เปิด `index.html` แล้วหา:

```js
const API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

เปลี่ยนเป็น URL `/exec` ของ Apps Script เช่น:

```js
const API_URL = 'https://script.google.com/macros/s/XXXXXXXXXXXX/exec';
```

## 4) อัปโหลดขึ้น GitHub

สร้าง repository เช่น `book-registry` แล้วอัปโหลด:

- `index.html`
- `README.md`

จากนั้นเปิด **Settings → Pages**

เลือก:

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/ (root)`

GitHub จะสร้าง URL เช่น:

`https://ชื่อผู้ใช้.github.io/book-registry/`

## 5) API ที่ใช้ในระบบ

หน้าเว็บเรียก Apps Script ผ่าน action เหล่านี้:

- `getHistory`
- `processForm`
- `updateRecord`
- `cancelRecord`
- `attachFile`

การอ่านข้อมูลใช้ JSONP ส่วนการเพิ่ม/แก้ไข/ยกเลิก/แนบไฟล์ใช้ POST + requestId และตรวจผลผ่าน JSONP อีกครั้ง

แนวทางนี้ทำขึ้นเพื่อให้หน้าเว็บที่อยู่บน GitHub Pages ทำงานข้ามโดเมนกับ Apps Script ได้ โดยไม่ต้องพึ่ง CORS response header ของ Apps Script

## 6) การทดสอบ API

เปิด URL `/exec` ของ Apps Script ในเบราว์เซอร์ ถ้าทำงานปกติควรได้ JSON ประมาณนี้:

```json
{
  "success": true,
  "service": "ระบบทะเบียนหนังสือ API",
  "version": "github-api-1.0"
}
```

ทดสอบอ่านข้อมูลด้วย:

`/exec?action=getHistory&prefix=testCallback`

## หมายเหตุเรื่องความปลอดภัย

GitHub Pages เป็นหน้าเว็บสาธารณะ ดังนั้น **อย่าใส่ API secret, password หรือ credential สำคัญลงใน `index.html`**

API เวอร์ชันนี้เหมาะกับระบบภายในที่ URL ถูกแชร์เฉพาะผู้ใช้งานที่กำหนด และควรตั้งสิทธิ์ Web App ให้เหมาะกับการใช้งานจริง

ข้อมูลที่อ่านผ่าน `getHistory` สามารถถูกเรียกจากหน้าเว็บอื่นได้หาก Web App เปิดให้ผู้ใช้เข้าถึงแบบสาธารณะ ดังนั้นหากข้อมูลเป็นความลับ ควรเพิ่มระบบยืนยันตัวตน/สิทธิ์ก่อนเปิดใช้งานจริง

## หมายเหตุเรื่องไฟล์แนบ

ระบบเดิมรองรับไฟล์สูงสุด 25 MB และเวอร์ชัน GitHub นี้ยังคงกำหนดไว้ 25 MB เช่นเดิม แต่การส่งไฟล์ผ่าน HTTP API จะมี overhead จาก Base64 และใช้หน่วยความจำของเบราว์เซอร์มากขึ้น

ถ้าต้องการรองรับไฟล์ขนาดใหญ่หรือใช้งานหลายคนพร้อมกัน แนะนำให้แยกระบบอัปโหลดไฟล์เป็นอีกขั้นในอนาคต

## เพิ่มเติม: ออกเลขหนังสือสำหรับเรื่องร้องเรียน

เรื่องร้องเรียนสามารถออกเลขหนังสือได้ 2 วิธี:

1. ตอนบันทึกเรื่องร้องเรียน ให้ติ๊ก **ออกเลขหนังสือพร้อมบันทึกเรื่องร้องเรียน** ระบบจะใช้เลขชุด "ส่ง" ของปีงบประมาณเดียวกัน
2. หลังบันทึกแล้ว ไปที่ประวัติเรื่องร้องเรียน แล้วกด **ออกเลขหนังสือ**

เลขที่ออกจะถูกเก็บในคอลัมน์ **เลขที่หนังสือออก** ของชีต `DATAร้องเรียน` และระบบจะนำเลขนี้ไปนับรวมกับเลขหนังสือส่ง เพื่อป้องกันเลขซ้ำ
