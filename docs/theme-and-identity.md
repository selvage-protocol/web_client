# Theme and identity

The page is dark only, in Catppuccin Mocha with a mauve accent, on the landing page's own tokens, all
of it in the shell's inline CSS so the card paints without waiting on a stylesheet. Monaco runs a
`selvage-mocha` theme on a `vs-dark` base in the same colours, with the comment and line-number tokens
stepped one shade lighter, because Mocha's overlay1 is 4.4:1 on the editor ground and under AA for the
two dims a reader reads most.

The card and the session bar wear a 104 px render of `public/mark-transparent.png`, the site's copy
byte-identical, inlined in the shell and levelled for the dark ground it lands on: the same gamma
curve the site applies to its own nav mark, because the owner's artwork is dark enough that the
typical ink pixel measured 1.72:1 on this page's card, and 5.0:1 after the curve.
`scripts/mark-level.mjs` owns the whole derivation (the area-averaged resample of an alpha image is
not the same operation in every ImageMagick release this page is built with, which is red CI rather
than a judgement call), and `test/identity.test.ts` measures that pixel over the card's own ground,
from the inlined file's own pixels, and fails a derivative that goes dark again. The tab is the
rasters `npm run build` renders from `mark-opaque.png` at the sizes the site serves (16, 32, 48, 180)
and the two the manifest names (192, 512). `node scripts/inline-mark.mjs` prints the data URI to paste
if the site's master changes, and the same test holds the two together byte for byte. The mark is the
owner's `svp` monogram in Mocha/mauve.
