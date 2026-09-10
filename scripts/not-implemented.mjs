#!/usr/bin/env node
/**
 * Reports a not-yet-delivered engineering command honestly.
 *
 * The command table in `docs/delivery/implementation.md` §3 is a delivery
 * contract: every script must exist from WP-00 on, but a script whose owning
 * work package has not landed must fail loudly instead of pretending success.
 */
const [command, ownerWorkPackage] = process.argv.slice(2);

const code = 'NOT_IMPLEMENTED';
const message = `command ${command ?? '<unknown>'} is not implemented yet; it lands with ${ownerWorkPackage ?? 'a later work package'}`;

process.stderr.write(`${code}: ${message}\n`);
process.exit(1);
