/*
 * The offline Company Intelligence build (SPEC §32, DD-16). A separate entry point
 * (`@diligenceiq/rag/profile`) so that no Lambda bundle can pull it in through the package's main
 * entry: only scripts/intelligence, scripts/evaluation and tests import it (a CDK test asserts
 * that no bundle contains the profile prompt or tool).
 */
export * from './library';
export * from './metrics';
export * from './assemble';
export * from './prompt';
export * from './evidence';
export * from './ledger';
export * from './validate';
export * from './build';
export * from './evaluate';
