# Orbit for Safari

Start `orbit webui` and open its authenticated workspace in Safari. Load this folder with **Safari → Settings → Developer → Add Temporary Extension**. If the Developer pane is hidden, enable web developer features in Advanced settings. A temporary extension lasts until Safari quits.

1. In the Orbit tab, click the Orbit toolbar button and connect the workspace.
2. In a regular HTTPS form or a loopback test page, click **Hand to Orbit**. Only the site's origin and up to twelve visible, empty text field labels go into the composer. Add the information you want to use, then send the request.
3. When Orbit replies, click the toolbar button and **Return to the form**. Open **Review Orbit’s draft**, edit the suggestions, and choose **Fill reviewed values**. Review and submit on the site yourself. Some sites autosave on input.

A handoff expires after ten minutes. Reloading a tab invalidates its connection. Disconnect in the workspace toolbar popup to end the pairing. The extension handles one form at a time, within the top-level page. It skips password controls, hidden and prefilled fields, and common payment and verification labels. Safari private browsing is excluded.

This assisted workflow runs in your Safari tab. Orbit's separate browser for unattended tasks continues to use its existing network restrictions.
