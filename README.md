# SheetHelper

A mobile-friendly field workspace for sending job photos, reports, and receipts to Google Sheets and Google Drive.

## Main workflows

- **Upload Photos:** choose a job and upload several photos. Files are renamed to `Job_YYYY-MM-DD.jpg` (`_2`, `_3`, and so on prevent collisions), saved in Drive, and recorded in `Photos`.
- **Field Report:** choose a job and write a short report. It is appended to `Reports`.
- **Receipt Upload:** choose a job and upload one receipt photo. It is renamed to `Job_receipt_YYYY-MM-DD.jpg`, saved in Drive, read with Google Cloud Vision, and recorded in `Receipt` with the detected total and line items.

Every job dropdown is loaded from column A of the `Jobs` tab. The app creates missing tabs and writes their header rows automatically:

| Tab | Columns |
| --- | --- |
| `Jobs` | Job |
| `Photos` | Job, Date, Photo |
| `Reports` | Job, Date, Report |
| `Receipt` | Job, Date, Photo, Total, Line Items |

## Google setup

1. Create a Google Cloud service account.
2. Enable the **Google Sheets API**, **Google Drive API**, and **Cloud Vision API**.
3. Create a Google Sheet and a Drive folder.
4. Share both with the service account email as an editor.
5. Start SheetHelper, open Settings, and save the Spreadsheet ID, Drive folder ID, service account email, and private key.
6. Add job names to `Jobs`, starting in cell `A2`, then refresh the job dropdowns.

Drive links remain governed by the permissions on the destination folder.

## Local development

Requires Node.js 20 or newer.

```bash
npm install
npm run check
npm start
```

Open `http://localhost:3000`.

## Railway deployment

Connect the repository to Railway. The included `railway.json` uses `npm start`.

For persistent in-app settings, attach a Railway volume and set:

```text
SETTINGS_FILE_PATH=/data/app-settings.json
```

Credentials may instead be supplied as environment variables:

```text
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
SITE_MASTER_PIN=
SITE_UNLOCK_SECRET=
APP_TIMEZONE=America/Los_Angeles
```

`SITE_MASTER_PIN` is optional and must contain four digits. Set `SITE_UNLOCK_SECRET` to a stable random value so unlock sessions remain valid across restarts.

The master PIN unlocks both the workspace and Settings. A PIN saved from the
Settings page unlocks only the main workspace. Google connection fields and the
user access PIN can be saved independently.
