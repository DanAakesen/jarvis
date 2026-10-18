import { pathToFileURL } from 'node:url';
import sql from 'mssql';
import { loadDatabaseConfig } from '../../database/config.js';
import { generateBundle, VARIANTS } from './generate.js';
import { importBundle, reconcileBundle, writeMigrationReport, IMPORT_CONFLICT_EXIT_CODE } from './importer.js';
import { validateBundle } from './validate.js';

export const CLI_FLAGS = [
  '--help', '--bundle', '--seed', '--variant', '--rows', '--report-dir', '--now', '--memory-budget-bytes',
  '--owner-object-id', '--state-dir', '--execute', '--batch-size', '--tables', '--report',
] as const;
export const HELP = `Temporary Daily migration tooling. Generation and validation are offline; import and reconcile use only the configured SQL connection.
generate --bundle PATH --seed INTEGER [--variant NAME] [--rows N]
validate --bundle PATH --report-dir PATH [--now ISO_TIMESTAMP] [--memory-budget-bytes N]
import --bundle PATH --owner-object-id GUID --state-dir PATH [--execute] [--batch-size N] [--tables TABLE,...] [--report PATH]
reconcile --bundle PATH --owner-object-id GUID [--batch-size N] [--tables TABLE,...] [--report PATH]
--help
Variants: ${VARIANTS.join(', ')}
No network, source access or activation. Import requires an explicit configured owner and defaults to dry run. Output never includes supplied paths or row values.
`;

export async function main(args: string[], output: (text: string) => void = text => process.stdout.write(text)): Promise<number> {
  let reportPath: string | undefined;
  let bundlePath: string | undefined;
  let statePath: string | undefined;
  try {
    if ((args.length === 1 && args[0] === '--help')
      || (args.length === 2 && ['generate', 'validate', 'import', 'reconcile'].includes(args[0]!) && args[1] === '--help')) { output(HELP); return 0; }
    const command = args[0];
    if (command !== 'generate' && command !== 'validate' && command !== 'import' && command !== 'reconcile') {
      output('cli-invalid-arguments\n'); return 2;
    }
    const values: Record<string, string> = {};
    const booleans = new Set<string>();
    const allowed = command === 'generate' ? ['--bundle', '--seed', '--variant', '--rows']
      : command === 'validate' ? ['--bundle', '--report-dir', '--now', '--memory-budget-bytes']
        : command === 'import'
          ? ['--bundle', '--owner-object-id', '--state-dir', '--batch-size', '--tables', '--report', '--execute']
          : ['--bundle', '--owner-object-id', '--batch-size', '--tables', '--report'];
    for (let i = 1; i < args.length;) {
      const flag = args[i];
      if (!flag || !allowed.includes(flag) || Object.hasOwn(values, flag) || booleans.has(flag)) {
        output('cli-invalid-arguments\n'); return 2;
      }
      if (flag === '--execute') { booleans.add(flag); i++; continue; }
      const value = args[i + 1];
      if (!value || value.startsWith('--')) { output('cli-invalid-arguments\n'); return 2; }
      values[flag] = value;
      i += 2;
    }
    bundlePath = values['--bundle'];
    reportPath = values['--report'];
    statePath = values['--state-dir'];
    if (!values['--bundle'] || (command === 'generate' ? values['--seed'] === undefined : !values['--report-dir'])) {
      if (command !== 'import' && command !== 'reconcile') { output('cli-invalid-arguments\n'); return 2; }
    }
    const number = (flag: string): number | undefined => {
      const value = values[flag];
      if (value === undefined) return undefined;
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error();
      return Number(value);
    };
    if (command === 'generate') {
      await generateBundle({ bundle: values['--bundle']!, seed: number('--seed')!, variant: values['--variant'], rows: number('--rows') });
      output('synthetic-bundle-created\n'); return 0;
    }
    if (command === 'validate') {
      if (!values['--report-dir']) { output('cli-invalid-arguments\n'); return 2; }
      const report = await validateBundle({
        bundle: values['--bundle']!, reportDir: values['--report-dir'],
        now: values['--now'], memoryBudgetBytes: number('--memory-budget-bytes'),
      });
      output(report.valid ? 'validation-passed\n' : 'validation-failed\n');
      return report.valid ? 0 : 1;
    }
    if (!values['--owner-object-id'] || command === 'import' && !values['--state-dir']) {
      output('cli-invalid-arguments\n'); return 2;
    }
    const tables = values['--tables']?.split(',');
    if (tables?.some(table => !table)) { output('cli-invalid-arguments\n'); return 2; }
    const configuration = loadDatabaseConfig();
    if (!configuration) { output('operation-failed\n'); return 2; }
    const pool = new sql.ConnectionPool(configuration);
    try {
      const report = command === 'import'
        ? await importBundle({
          bundle: values['--bundle']!, ownerObjectId: values['--owner-object-id']!, stateDir: values['--state-dir']!,
          execute: booleans.has('--execute'),
          ...(number('--batch-size') === undefined ? {} : { batchSize: number('--batch-size')! }),
          ...(tables === undefined ? {} : { tables }),
        }, pool)
        : await reconcileBundle({
          bundle: values['--bundle']!, ownerObjectId: values['--owner-object-id']!,
          ...(number('--batch-size') === undefined ? {} : { batchSize: number('--batch-size')! }),
          ...(tables === undefined ? {} : { tables }),
        }, pool);
      if (reportPath) await writeMigrationReport(reportPath, bundlePath!, statePath, report);
      output(`${JSON.stringify(report)}\n`);
      return report.status === 'conflicts' ? IMPORT_CONFLICT_EXIT_CODE : report.status === 'differences' ? 1 : 0;
    } finally { await pool.close(); }
  } catch (error) {
    const report = error && typeof error === 'object' ? (error as { report?: import('./importer.js').MigrationReport }).report : undefined;
    if (report && reportPath && bundlePath) {
      try { await writeMigrationReport(reportPath, bundlePath, statePath, report); } catch { /* Keep diagnostics value-free. */ }
    }
    output(report ? `${JSON.stringify(report)}\n` : 'operation-failed\n');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
