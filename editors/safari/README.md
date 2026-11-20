# Orbit for Safari

Start `orbit webui --open` on macOS to open the workspace in Safari. For a built or installed CLI, `orbit webui --safari-extension-path` prints the extension folder. Load that folder (or this source folder) with **Safari → Settings → Developer → Add Temporary Extension**. If the Developer pane is hidden, enable web developer features in Advanced settings. A temporary extension lasts until Safari quits.

1. In the Orbit tab, click the Orbit toolbar button and connect the workspace.
2. In a regular HTTPS form or a loopback test page, click **Hand to Orbit**. If there are several forms, first click a text field in the intended form. Only the site's origin and up to twelve visible, empty text field labels go into the composer. Add the information you want to use, then send the request.
3. When Orbit replies, click the toolbar button and **Return to the form**. Open **Review Orbit’s draft**, edit the suggestions, and choose **Fill reviewed values**. Review and submit on the site yourself. Some sites autosave on input.

A handoff expires after ten minutes. Reloading a tab invalidates its connection. Disconnect in the workspace toolbar popup to end the pairing. The extension handles one form at a time, within the top-level page. It skips password controls, hidden and prefilled fields, and common payment and verification labels. Safari private browsing is excluded.

Choose **Ask about this page or selection** in the toolbar to add the page title, address and up to 4,000 characters of selected text to an empty Orbit draft. The address excludes credentials, query and fragment. Review the draft in Orbit before sending.
