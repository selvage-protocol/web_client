# The build

`npm run build` wipes `dist/` and rebuilds it wholesale, because chunk names carry content hashes and
anything else would strand orphaned bundles. The output is minified and code-split: the page loads the
editor core and the language service up front, tokenizers load when a document of that language opens,
and the two workers are fetched only when a mode needs them. The build refuses a bundle containing the
`ws` package and refuses one that lacks `monaco-editor`. It copies the shell, renders the sized icons
and writes `dist/site.webmanifest`.
