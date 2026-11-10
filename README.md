# KTU class check-in

Students open a link, enter their index number, pick their programme and tap **Check in**.
The phone's location is saved once and compared with the lecturer's location. Lecturers see
who checked in, how far away they were, and can download a CSV.

Everything runs on free tiers: **GitHub Pages** (hosting) + **Supabase** (database and lecturer login).
There is no build step. It is plain HTML and JavaScript.

## Files

| File | Purpose |
|---|---|
| `index.html`, `student.js` | Student check-in page |
| `teacher.html`, `teacher.js` | Lecturer page (sign in, start a class, view and export) |
| `programmes.js` | KTU programmes shown in the dropdown (edit as needed) |
| `config.js` | Your Supabase URL and anon key |
| `supabase/schema.sql` | Database tables, security rules and check-in function |

## Setup

### 1. Supabase (database)
1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, click **Run**.
3. Open **Authentication > Users > Add user**, create your lecturer account (email and password, auto-confirm).
4. In the Authentication settings, turn **off** "Allow new users to sign up", so only accounts you create can sign in.
5. Open **Project Settings > API**. Copy the **Project URL** and the **anon / publishable key** into `config.js`.
   Never use the `service_role` key here.

### 2. GitHub (code) from cmd
Create an empty **public** repository named `ktu-attendance` on github.com, then in cmd, inside this folder:

```
git init
git add .
git commit -m "KTU attendance app"
git branch -M main
git remote add origin https://github.com/YankeyTech/ktu-attendance.git
git push -u origin main
```

### 3. Hosting (GitHub Pages)
Repository **Settings > Pages > Build and deployment**: Source = **Deploy from a branch**, Branch = **main**, folder = **/ (root)**, then Save.
After a minute the site is live at `https://yankeytech.github.io/ktu-attendance/`.

- Students: `.../ktu-attendance/` (or the link shown on your lecturer page, which already includes the class code)
- Lecturers: `.../ktu-attendance/teacher.html`

### Updating later
Edit files, then in cmd: `git add .`, `git commit -m "describe the change"`, `git push`. Pages redeploys by itself.

## Using it in class
1. Sign in on `teacher.html`, stand in the classroom, enter the course and press **Start check-in here**.
2. Share the code or link with the students (board, WhatsApp group).
3. Watch the list fill in. **Close check-in now** when done, then **Download CSV**.

## Limits to know about
- Browser location can be faked, and one student could type another's index number. The distance and "in class area" columns help you spot odd entries; they are not proof.
- Indoors, GPS can be off by tens of metres. The default 100 m allowance and a 50 m GPS-error tolerance are set for that. Change the allowed distance per class.
- Location data is personal data. Tell students why it is collected and delete old sessions when you no longer need them.
- Free Supabase projects may pause after a period of no use. If the app stops responding, open the Supabase dashboard and resume the project.
