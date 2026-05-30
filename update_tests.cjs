const fs = require("fs");
const files = [
  "src/tests/validators.test.ts",
  "src/tests/errors.test.ts",
  "src/tests/requires.test.ts",
  "src/tests/transformer.test.ts",
];

for (const f of files) {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");
    content = content.replace(/error: .string./g, `error: "Type<string>"`);
    content = content.replace(/error: .number./g, `error: "Type<number>"`);
    content = content.replace(/error: .boolean./g, `error: "Type<boolean>"`);
    content = content.replace(/error: .undefined./g, `error: "Type<undefined>"`);
    content = content.replace(/error: .array./g, `error: "Type<Array>"`);
    content = content.replace(/error: .object./g, `error: "Type<Object>"`);
    content = content.replace(/error: .Set./g, `error: "Type<Set>"`);
    content = content.replace(/error: .Map./g, `error: "Type<Map>"`);
    content = content.replace(/error: .Date./g, `error: "Type<Date>"`);
    
    // Custom replacements for others
    content = content.replace(/error: 'literal (.*?)'/g, (match, p1) => `error: 'Literal<${p1}>'`);
    content = content.replace(/error: 'tuple of length (.*?)'/g, (match, p1) => `error: 'Tuple<${p1}>'`);
    content = content.replace(/error: 'property not allowed: (.*?)'/g, (match, p1) => `error: 'PropertyNotAllowed<${p1}>'`);
    content = content.replace(/error: .union./g, `error: "Type<Union>"`);

    // requires
    content = content.replace(/error: .requires host \(host\)./g, `error: "Requires<host>"`);
    content = content.replace(/error: .requires \\.password \(profile\\.details\\.password\)./g, `error: "Requires<.password>"`);
    content = content.replace(/error: .requires \\.\\.status \(profile\\.status\)./g, `error: "Requires<..status>"`);
    content = content.replace(/expect\(ctx.*\.error\)\.toBe\(.requires host \(host\).\);/g, `expect(ctxMissing.errors[0].error).toBe("Requires<host>");`);
    content = content.replace(/expect\(ctx.*\.error\)\.toBe\(.requires \\.password \(profile\\.details\\.password\).\);/g, `expect(ctxMissing.errors[0].error).toBe("Requires<.password>");`);
    content = content.replace(/expect\(ctx.*\.error\)\.toBe\(.requires \\.\\.status \(profile\\.status\).\);/g, `expect(ctxMissing.errors[0].error).toBe("Requires<..status>");`);
    
    // union tests expect `.toBe('string')` -> `.toBe('Type<string>')`
    content = content.replace(/\.toBe\('union'\)/g, `.toBe('Type<Union>')`);
    content = content.replace(/\.toBe\('string'\)/g, `.toBe('Type<string>')`);
    content = content.replace(/\.toBe\('number'\)/g, `.toBe('Type<number>')`);
    content = content.replace(/\.toBe\('object'\)/g, `.toBe('Type<Object>')`);

    fs.writeFileSync(f, content);
  }
}
