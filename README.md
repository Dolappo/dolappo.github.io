# dolappo.github.io

Personal site of Dolapo James Falana: software & AI engineer. Plain HTML/CSS/JS served by GitHub Pages (no build step).

- `index.html`: all content
- `assets/style.css`: design tokens, layout, hover list, research panels, mobile rules
- `assets/main.js`: Industry/Academic switch, blend cursor, floating experience preview, smooth scroll, reveals
- `assets/fluid.js`: cursor-driven WebGL smoke (port of Pavel Dobryakov's MIT-licensed fluid simulation); desktop only, falls back to a static glow

To add a photo, save it as `assets/photo.jpg` and swap the `DF` span in the About section for the `<img>` shown in the comment. To add a CV, email or LinkedIn, uncomment the buttons in the Contact section.

Experience preview cards come from each row's `data-kicker`, `data-metric` and `data-hue` attributes.

Tip: link `https://dolappo.github.io/?mode=academic` in academic applications to open the site in Academic view.
