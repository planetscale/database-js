#!/usr/bin/env bash
set -e

run_sql() {
  name=$1
  query=$2
  echo "{\"query\":\"$query\"}" |
  curl -s -u $MYSQL_USER:$MYSQL_PWD \
  -d@- -H'content-type: application/json' \
  https://$MYSQL_HOST/psdb.v1alpha1.Database/Execute | jq .result > $name.json
  jq . $name.json
}

cat test.sql | mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PWD

run_sql 'database' 'select *, NULL from `test`'
run_sql 'dual' 'select _latin1 0xff as a'
