# Golden tests

This generates a "golden" test result that feeds the "parse e2e" test suite.

The intent is a full round trip with a known table that exercises every column type with known correct data.

This excercises different collations, charsets, every integer type.

`test.sql` acts as the seed data against a PlanetScale branch, then we fetch the data back with `curl`.

We can run different queries inside the `generate.sh` script either against the current data, or tests that run against `dual`.

The results are stored back in `$case.json` and a compact version stored in `$case-compact.json`. This compact version is what is shoved into the mock test result for convenience.

Along with this is a `cli.txt` which is the result of running `select * from test` in a mysql CLI dumping the full human readable table. This table is a good reference for what is expected to be human readable or not. Raw binary data is represented as hexadecimal, vs UTF8 strings are readable.
