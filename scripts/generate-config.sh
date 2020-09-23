#!/bin/sh
cat > generated-config.yml <<HEREDOC
stages:
  - trigger
trigger_internal_ci:
  stage: trigger
  variables:
    CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME: $CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME
    EXT_PULL_REQUEST_IID: $CI_EXTERNAL_PULL_REQUEST_IID
  trigger:
    project: zhernovs/test-sdk-6
    strategy: depend
    branch: $TRIGGER_BRANCH
HEREDOC

