export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kossilon Hub</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f8f5ef; color: #2d2924; }
      main { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
      section { max-width: 560px; background: white; border: 1px solid #e6dfd2; border-radius: 12px; padding: 32px; box-shadow: 0 20px 60px rgb(45 41 36 / 8%); }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0; line-height: 1.6; color: #675f53; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Something needs attention</h1>
        <p>Kossilon Hub could not render this screen. The team has enough detail in the server logs to investigate.</p>
      </section>
    </main>
  </body>
</html>`;
}
