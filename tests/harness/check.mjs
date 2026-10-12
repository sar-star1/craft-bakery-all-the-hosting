export function makeChecker() {
  let pass = 0;
  let fail = 0;
  return {
    check(name, ok, detail = "") {
      ok ? pass++ : fail++;
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + detail}`);
    },
    done() {
      console.log(`\n${pass} passed, ${fail} failed`);
      return fail === 0;
    },
  };
}
