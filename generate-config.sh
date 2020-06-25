#!/bin/sh
cat > generated-config.yml <<HEREDOC
trigger_internal_ci:
  variables:
    EXT_PULL_REQUEST_TARGET_BRANCH_NAME: $CI_EXTERNAL_PULL_REQUEST_TARGET_BRANCH_NAME
    EXT_PULL_REQUEST_SOURCE_BRANCH_NAME: $CI_EXTERNAL_PULL_REQUEST_SOURCE_BRANCH_NAME
    EXT_PULL_REQUEST_IID: $CI_EXTERNAL_PULL_REQUEST_IID
    TRIGGER_BRANCH: $TRIGGER_BRANCH
  trigger:
    project: zhernovs/test-sdk-6
    strategy: depend
    branch: $TRIGGER_BRANCH
HEREDOC

# cat > generated-config.yml <<HEREDOC
# test_inherited_var_feature:
#   script:
#     - echo "VAR $TRIGGER_BRANCH"
# HEREDOC
