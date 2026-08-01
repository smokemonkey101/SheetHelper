# MHC Tools

A mobile-friendly field workspace for sending job photos, task reports, receipts, and categorized files to Google Sheets and Google Drive.

## Main workflows

- **Upload Photos:** choose a job and upload several photos. Files are renamed to `Job_YYYY-MM-DD.jpg` (`_2`, `_3`, and so on prevent collisions), saved in Drive, and recorded in `Photos`.
- **Task Report:** choose a job, optionally choose an unfinished task from `Task ToDo`, and write a report. It is appended to `Task Reports`; selected tasks can be marked updated or finished.
- **Receipt Upload:** choose a job and upload one receipt. It is saved in Drive, read with Google Cloud Vision when it is an image, and recorded in `Receipt` with its total, store, and purchase date.
- **Upload Files (master only):** upload files to the `Accounting`, `Leads`, or `Other` tab with an optional tag.

Every job dropdown is loaded from column A of the `Jobs` tab. The app creates missing tabs and writes their header rows automatically:

| Tab | Columns |
| --- | --- |
| `Jobs` | Job |
| `Photos` | Job, Person, Date, Photo |
| `Reports` | Job, Person, Date, Report |
| `Receipt` | Job, Person, Date, Photo, Total, Store, Purchase Date |
| `Task Reports` | Job, Person, Date, Task, Input |
| `Task ToDo` | Job, Date Assigned, Assigned To, Status, Task |
| `Accounting` | Job, Person, Date, File, Tag |
| `Leads` | Job, Person, Date, File, Tag |
| `Other` | Job, Person, Date, File, Tag |

## Google setup

1. Create a Google Cloud service account.
2. Enable the **Google Sheets API**, **Google Drive API**, and **Cloud Vision API**.
3. Create a Google Sheet and share it with the service account as an editor.
4. Configure the OAuth consent screen and create a Web application OAuth client.
5. Start MHC Tools and open Settings. Copy the displayed redirect URI into the
   OAuth client's authorized redirect URIs.
6. Save the Spreadsheet ID, service account email/private key, OAuth client ID,
   and OAuth client secret.
7. Select **Connect Google Drive** and approve the `drive.file` permission with
   the Google account whose personal Drive should store uploads. MHC Tools
   creates an `MHC Tools Uploads` folder owned by that user.
8. Add job names to `Jobs`, starting in cell `A2`, then refresh the job dropdowns.

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

All deployment settings can be supplied as Railway environment variables. These override values saved through the Settings page:

```text
GOOGLE_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_DRIVE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
PUBLIC_URL=https://work.mhc211757.com
GOOGLE_OAUTH_REDIRECT_URI=
SITE_MASTER_PIN=
SITE_UNLOCK_SECRET=
APP_TIMEZONE=America/Los_Angeles
```

`SITE_MASTER_PIN` is optional and must contain four digits. Set `SITE_UNLOCK_SECRET` to a stable random value so unlock sessions remain valid across restarts.

The master PIN unlocks both the workspace and Settings. Worker names and four-digit
codes come from the `Jobs` tab: names in column E and codes in column F, beginning
on row 2. Worker codes unlock only the main workspace.
