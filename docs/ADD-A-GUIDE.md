# How to Add a Sermon Guide (no coding required)

You can add a new sermon guide entirely from your web browser on GitHub.
You do **not** need to install anything or use a command line.

When you're done, the website rebuilds and publishes itself automatically — it
usually goes live a couple of minutes after you save.

There are two ways to do it. **The form is the easiest** — start there.

---

## Easiest: paste it into a form

1. Go to the repo's **Issues** tab:
   <https://github.com/hmcc-global/sermonguide/issues>
2. Click **New issue**, then choose **New Sermon Guide → Get started**.
3. Paste your guide into the one big text box, in this format:

   ```markdown
   # SERIES — Part N: Subtitle
   Date: 2026-06-22
   Scripture: Luke 1:46-55

   ## Recap
   First paragraph of the recap.

   Second paragraph (leave a blank line between paragraphs).

   ## One Thing
   The single biggest takeaway in one sentence.

   ## Discussion Questions
   ### Connecting
   - An opening question?
   ### Committing
   - A question about what to do this week?

   ## Next Steps
   - First step.
   - Second step.
   ```

   Only the scripture **reference** is needed — the verses are looked up for you.

4. Click **Submit new issue**.

That's it. A bot reads your guide, publishes it, and posts the live link back in
the issue within a few minutes. If anything in the format is off, the bot
comments to tell you what to fix — just edit the issue and it tries again.

> **Tip:** You can have an AI (ChatGPT/Claude) produce this exact format from a
> sermon transcript or your notes, then paste the result into the form.

---

## Alternative: edit a file directly

Prefer working with the files? You can also add a guide by creating a YAML file
in the `content/` folder. The rest of this page covers that approach.

---

## What you'll need

- A GitHub account that has access to the `hmcc-global/sermonguide` repository.
- The sermon's info: series name, the Bible passage **reference** (e.g.
  `Luke 1:46-55`), a short recap, discussion questions, and next steps.

You do **not** need to type out the Bible verses — just the reference. The site
looks up the verses for you.

---

## Step 1 — Open the content folder

1. Go to <https://github.com/hmcc-global/sermonguide>.
2. Click the **`content`** folder.

This folder holds one file per sermon guide.

## Step 2 — Start a new file from the template

The easiest way is to copy the template:

1. In the `content` folder, click **`_TEMPLATE.yaml`** to open it.
2. Click the **pencil icon** (✏️ "Edit this file") in the top-right of the file.
3. Select all the text and copy it.
4. Go back to the `content` folder, and click **Add file → Create new file**.
5. In the filename box at the top, type a name ending in `.yaml`. Use lowercase
   words separated by hyphens. **This name becomes the web address**, so:
   - `adore-5.yaml`  →  publishes at `.../adore-5.html`
   - Don't use spaces or capital letters.
   - Don't start the name with an underscore (`_`).
6. Paste the template text into the big editing box.

## Step 3 — Fill in your guide

Edit the pasted text to match this week's sermon. A few rules:

- Keep the **quotation marks** around text.
- Keep the **indentation** (the spaces at the start of lines) as it is — it
  matters.
- Lines starting with `#` are just instructions; you can leave or delete them.
- For the scripture, only enter the **reference**, like:
  ```
  scripture_title: "Titus 2"
  ```
  The verses are fetched automatically.
- Under `recap`, `discussion_questions`, and `next_steps`, each line that starts
  with `- ` is one item. Add or remove lines to fit.

There's a filled-in example at the bottom of this page.

## Step 4 — Save (this publishes it)

1. Scroll to the bottom of the page.
2. Under **Commit new file**, you can leave the default message or write
   something like "Add Adore Part 5 guide".
3. Make sure **"Commit directly to the `main` branch"** is selected.
4. Click **Commit new file**.

That's it. Saving to `main` automatically starts the publish process.

## Step 5 — Check that it published

1. Click the **Actions** tab at the top of the repository.
2. You'll see your change listed with a spinning yellow dot (building) that
   turns into a green checkmark (published) after a minute or two.
3. Once it's green, your guide is live on the site.

If you ever see a **red X**, something in the file wasn't formatted correctly
(usually a missing quote or wrong indentation). Open your file, click the pencil
to edit, fix it, and commit again — or ask a developer to take a look.

---

## Editing or fixing a guide you already added

1. Open the file in the `content` folder.
2. Click the **pencil icon** (✏️).
3. Make your changes.
4. Scroll down and **Commit changes** to `main`.

The site rebuilds and republishes the same way.

---

## A filled-in example

```yaml
series: "ADORE"
part: "Part 5: Worship With Joy"
date: "2026-06-22"

scripture_title: "Luke 1:46-55"

recap:
  - "Pastor Pete closed our Adore series in the Magnificat, where Mary's
     response to God's promise overflows into worship and joy."
  - "Joy, he reminded us, isn't the absence of hard circumstances — it's the
     overflow of trusting who God is in the middle of them."

one_thing: "Joy grows from worship, not from circumstances."

discussion_questions:
  Connecting:
    - "When was a time you felt genuine joy that wasn't tied to things going well?"
  Confessing:
    - "Where are you currently waiting on God, and how is that testing your joy?"
  Committing:
    - "What is one way you can choose worship over worry this week?"

next_steps:
  - "Write down three things God has already been faithful in, and thank Him."
  - "Share one current 'waiting' with your group so they can pray with you."
```
