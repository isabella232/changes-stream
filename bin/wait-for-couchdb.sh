#!/usr/bin/env bash

TRY=1
MAX=5
URL="http://admin:admin@0.0.0.0:59840/"
START=$SECONDS

echo "Waiting for CouchDB @ ${URL}"

while [[ "$(curl --silent -o /dev/null -w ''%{http_code}'' $URL)" != "200" ]]; do
  if [ ${TRY} -eq ${MAX} ];then
    echo "Max attempts reached after $(( $SECONDS - $START ))"
    exit 1
  fi

  TRY=$(($TRY+1))
  sleep 5
done

echo "Connected after $(( $SECONDS - $START )) seconds after ${TRY} attempts"
curl --silent -w ''%{http_code}'' $URL
