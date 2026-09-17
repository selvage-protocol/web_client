/*! keep-me-legal */
/** doc sample URI.parse("file://server/x") */
export const file = 1;
const re = /(file:|vscode-file:\/\/vscode-app)?(\/[^:]*:\d+)/;
console.log(re, file);
