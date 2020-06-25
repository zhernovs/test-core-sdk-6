#!/bin/sh
# echo "trigger_internal_ci:
#   stage: trigger
#   variables:
#     EXT_PULL_REQUEST_TARGET_BRANCH_NAME: $CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME
#     EXT_PULL_REQUEST_SOURCE_BRANCH_NAME: $CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME
#     EXT_PULL_REQUEST_IID: $CI_EXTERNAL_PULL_REQUEST_IID
#     TRIGGER_BRANCH: $TRIGGER_BRANCH
#   trigger:
#     project: zhernovs/test-sdk-6
#     strategy: depend
#     branch: $TRIGGER_BRANCH" > generated-config.yml

echo "test_inherited_var_feature:
  stage: trigger
  script:
    - env" > generated-config.yml