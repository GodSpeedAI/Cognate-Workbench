// The phone's HTML shell. It holds no secret and no data: the pairing fragment is read and stripped by
// the bundled app before anything else happens.
export function phoneShell(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Cognate Workbench remote</title>
<link rel="stylesheet" href="/m/mobile.css">
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="/m/app.js"></script>
</body>
</html>`;
}
