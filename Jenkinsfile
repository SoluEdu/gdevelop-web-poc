pipeline {
    agent any

    triggers {
        githubPush()
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '20'))
        timestamps()
        ansiColor('xterm')
        // disableConcurrentBuilds removed — diganti lock per-env Opsi C di stage Deploy/Health Check
        // supaya staging vs prod paralel boleh, staging vs staging serial
    }

    environment {
        // ==========================================
        // Harbor Registry
        // ==========================================
        HARBOR_CREDENTIAL_ID = 'harbor-registry-creds'
        HARBOR_HOST          = 'registry.solu.co.id'
        HARBOR_PROJECT       = 'gdevelop'
        IMAGE_NAME           = 'gdevelop-web-poc'
        TRIVY_VERSION        = '0.74.0'

        // ==========================================
        // Staging Credentials
        // ==========================================
        SSH_CREDENTIAL_ID_STAGING = 'ssh-remote-staging'
        ENV_CREDENTIAL_ID_STAGING = 'gdevelop-frontend-env-staging'

        // ==========================================
        // Production Credentials
        // ==========================================
        SSH_CREDENTIAL_ID_PROD = 'ssh-remote-prod'
        ENV_CREDENTIAL_ID_PROD = 'gdevelop-frontend-env-production'
    }

    stages {

        // ------------------------------------------
        // 1. Checkout & Validate
        // ------------------------------------------
        stage('Checkout & Validate') {
            steps {
                echo "Checking out branch: ${env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'detected branch'}"
                checkout scm

                script {
                    def version = readFile('VERSION').trim()
                    if (!version) {
                        error "VERSION file kosong"
                    }
                    if (!version.startsWith('v')) {
                        error "Format VERSION tidak valid: ${version}. Gunakan semantic versioning (contoh: v1.0.0)"
                    }
                    // package.json sync check (warning saja)
                    def pkgVersion = readFile('package.json')
                    if (!pkgVersion.contains('"version"')) {
                        echo "WARNING: package.json version field missing"
                    }

                    def isProd = (env.BRANCH_NAME == 'prod')
                    def prefix = isProd ? 'prod' : 'staging'
                    env.IMAGE_TAG = "${prefix}-${version}-${env.BUILD_NUMBER}"
                    env.FULL_IMAGE = "${env.HARBOR_HOST}/${env.HARBOR_PROJECT}/${env.IMAGE_NAME}:${env.IMAGE_TAG}"

                    // fallback GIT_COMMIT jika checkout shallow
                    if (!env.GIT_COMMIT) {
                        env.GIT_COMMIT = sh(returnStdout: true, script: 'git rev-parse --short HEAD 2>/dev/null || echo unknown').trim()
                    }

                    echo "Branch     : ${env.BRANCH_NAME}"
                    echo "Version    : ${version} | Tag: ${env.IMAGE_TAG}"
                    echo "Full image : ${env.FULL_IMAGE}"
                    echo "Git commit : ${env.GIT_COMMIT}"
                }
            }
        }

        // ------------------------------------------
        // 2. Resolve Environment Config
        // ------------------------------------------
        stage('Resolve Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME == 'prod') {
                        env.DEPLOY_TARGET = 'production'
                    } else if (env.BRANCH_NAME == 'staging') {
                        env.DEPLOY_TARGET = 'staging'
                    } else {
                        echo "Branch '${env.BRANCH_NAME}' bukan 'prod'/'staging'."
                        echo "Hanya menjalankan Lint/Test/Build, tanpa Docker push / deploy."
                        env.DEPLOY_TARGET = 'none'
                        return
                    }

                    def envName = (env.DEPLOY_TARGET == 'production') ? 'prod' : 'staging'
                    def envFile = ".jenkins/${envName}.env"
                    echo "Loading environment from: ${envFile}"

                    readFile(envFile).split('\n').each { line ->
                        def trimmed = line.trim()
                        if (trimmed && !trimmed.startsWith('#')) {
                            def eqIdx = trimmed.indexOf('=')
                            if (eqIdx > 0) {
                                def key = trimmed.substring(0, eqIdx).trim()
                                def value = trimmed.substring(eqIdx + 1).trim()
                                // strip quotes if any
                                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                                    value = value.substring(1, value.length() - 1)
                                }
                                if (key == 'REMOTE_USER') env.REMOTE_USER = value
                                else if (key == 'REMOTE_HOST') env.REMOTE_HOST = value
                                else if (key == 'REMOTE_DIR') env.REMOTE_DIR = value
                                else if (key == 'HEALTH_CHECK_PORT') env.HEALTH_CHECK_PORT = value
                                else if (key == 'CONTAINER_NAME') env.CONTAINER_NAME = value
                                else if (key == 'HOST_BIND') env.HOST_BIND = value
                                else if (key == 'HOST_PORT') env.HOST_PORT = value
                                else if (key == 'CONTAINER_PORT') env.CONTAINER_PORT = value
                            }
                        }
                    }

                    if (!env.REMOTE_HOST || !env.REMOTE_USER) {
                        error "REMOTE_USER/HOST belum lengkap di ${envFile}"
                    }
                    if (!env.REMOTE_DIR) {
                        error "REMOTE_DIR belum diset di ${envFile}"
                    }
                    if (!env.HEALTH_CHECK_PORT) {
                        // fallback ke HOST_PORT jika HEALTH_CHECK_PORT tidak diset
                        if (env.HOST_PORT) {
                            env.HEALTH_CHECK_PORT = env.HOST_PORT
                            echo "HEALTH_CHECK_PORT fallback ke HOST_PORT=${env.HOST_PORT}"
                        } else {
                            error "HEALTH_CHECK_PORT/HOST_PORT belum diset di ${envFile}"
                        }
                    }
                    if (!env.HOST_PORT) {
                        env.HOST_PORT = env.HEALTH_CHECK_PORT
                    }
                    if (!env.HOST_BIND) {
                        echo "WARNING: HOST_BIND tidak diset di ${envFile}, pakai default 127.0.0.1"
                        env.HOST_BIND = '127.0.0.1'
                    }
                    if (!env.CONTAINER_PORT) {
                        echo "WARNING: CONTAINER_PORT tidak diset di ${envFile}, pakai default 80"
                        env.CONTAINER_PORT = '80'
                    }
                    if (!env.CONTAINER_NAME) {
                        echo "WARNING: CONTAINER_NAME tidak diset di ${envFile}, pakai default gdevelop-app"
                        env.CONTAINER_NAME = 'gdevelop-app'
                    }

                    if (env.DEPLOY_TARGET == 'production') {
                        env.SSH_CRED = env.SSH_CREDENTIAL_ID_PROD
                        env.ENV_CRED = env.ENV_CREDENTIAL_ID_PROD
                    } else {
                        env.SSH_CRED = env.SSH_CREDENTIAL_ID_STAGING
                        env.ENV_CRED = env.ENV_CREDENTIAL_ID_STAGING
                    }

                    echo "Deploy target : ${env.DEPLOY_TARGET}"
                    echo "Full image    : ${env.FULL_IMAGE}"
                    echo "Container     : ${env.CONTAINER_NAME}"
                    echo "Ports         : ${env.HOST_BIND}:${env.HOST_PORT}->${env.CONTAINER_PORT}"
                    echo "Remote target : ${env.REMOTE_USER}@${env.REMOTE_HOST}:${env.REMOTE_DIR}"
                    echo "Health check  : port ${env.HEALTH_CHECK_PORT}"
                }
            }
        }

        // ------------------------------------------
        // 3. Lint (fail-fast)
        // ------------------------------------------
        stage('Lint') {
            agent {
                docker {
                    image 'node:22.15.0-alpine'
                    reuseNode true
                }
            }
            environment {
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Running lint (oxlint + eslint)...'
                sh '''
                    set -euo pipefail
                    if [ ! -f package-lock.json ]; then
                        echo "package-lock.json missing, running npm install to generate"
                        npm install --package-lock-only --ignore-scripts
                    fi
                    npm ci --prefer-offline
                    {
                        echo "# Lint Report"
                        echo ""
                        echo '```'
                        npm run lint 2>&1
                        echo '```'
                        echo ""
                        echo "✅ lint passed"
                    } | tee lint-report.md
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'lint-report.md', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 4. Type Check
        // ------------------------------------------
        stage('Type Check') {
            agent {
                docker {
                    image 'node:22.15.0-alpine'
                    reuseNode true
                }
            }
            environment {
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Running vue-tsc type check...'
                sh '''
                    set -euo pipefail
                    npm ci --prefer-offline
                    {
                        echo "# Type Check Report"
                        echo ""
                        echo '```'
                        npm run type-check 2>&1
                        echo '```'
                        echo ""
                        echo "✅ type-check passed"
                    } | tee type-check-report.md
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'type-check-report.md', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 5. Unit Test
        // ------------------------------------------
        stage('Unit Test') {
            agent {
                docker {
                    image 'node:22.15.0-alpine'
                    reuseNode true
                }
            }
            environment {
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Running unit tests...'
                sh '''
                    set -euo pipefail
                    npm ci --prefer-offline
                    {
                        echo "# Unit Test Report"
                        echo ""
                        echo '```'
                        npm run test:unit -- --run --reporter=verbose 2>&1
                        echo '```'
                    } | tee unit-test-report.md
                    npm run test:unit -- --run --reporter=junit --outputFile=junit.xml 2>&1 | tee -a unit-test-report.md || npm run test:unit -- --run 2>&1 | tee -a unit-test-report.md
                '''
            }
            post {
                always {
                    junit testResults: 'junit.xml', allowEmptyResults: true
                    archiveArtifacts artifacts: 'unit-test-report.md,junit.xml', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 6. Security Scan - npm audit (block HIGH/CRITICAL)
        // ------------------------------------------
        stage('Security Scan - npm audit') {
            agent {
                docker {
                    image 'node:22.15.0-alpine'
                    reuseNode true
                }
            }
            environment {
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Running npm audit (HIGH/CRITICAL block)...'
                sh '''
                    set -euo pipefail
                    if [ ! -f package-lock.json ]; then
                        echo "package-lock.json missing, generating..."
                        npm install --package-lock-only --ignore-scripts
                    fi
                    npm ci --prefer-offline
                    {
                        echo "# npm audit Report"
                        echo ""
                        npm audit --json > npm-audit.json || true
                        echo '```json'
                        cat npm-audit.json
                        echo '```'
                        echo ""
                        npm audit --audit-level=high 2>&1
                    } | tee npm-audit-report.md
                    # blocking check (keep exit code)
                    npm audit --audit-level=high || {
                        echo "❌ npm audit found HIGH/CRITICAL — blocking" | tee -a npm-audit-report.md
                        exit 1
                    }
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'npm-audit-report.md,npm-audit.json', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 6b. Security Scan - trivy fs (block HIGH/CRITICAL)
        // ------------------------------------------
        stage('Security Scan - trivy fs') {
            agent {
                docker {
                    image 'aquasec/trivy:0.74.0'
                    reuseNode true
                    args '--entrypoint="" -e TRIVY_CACHE_DIR=/workspace/.trivy-cache -e XDG_CACHE_HOME=/workspace/.trivy-cache'
                }
            }
            steps {
                echo 'Running trivy fs scan (HIGH,CRITICAL block)...'
                sh '''
                    set -euo pipefail
                    echo "=== trivy fs scan (HIGH,CRITICAL block) ==="
                    mkdir -p .trivy-cache
                    {
                        echo "# Trivy FS Report"
                        echo ""
                        echo '```'
                        trivy fs --cache-dir .trivy-cache --severity HIGH,CRITICAL --format table --no-progress . 2>&1 || true
                        echo '```'
                    } | tee trivy-fs-report.md
                    trivy fs --cache-dir .trivy-cache --severity HIGH,CRITICAL --exit-code 1 --no-progress . || {
                        echo "❌ trivy fs found HIGH/CRITICAL — blocking" | tee -a trivy-fs-report.md
                        exit 1
                    }
                    echo "✅ trivy fs passed" | tee -a trivy-fs-report.md
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'trivy-fs-report.md', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 7. Build (single build — Plan A)
        // ------------------------------------------
        stage('Build') {
            agent {
                docker {
                    image 'node:22.15.0-alpine'
                    reuseNode true
                }
            }
            environment {
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Building Vue app (single build for Docker)...'
                sh """#!/bin/bash
                    set -euo pipefail
                    npm ci --prefer-offline
                    export VITE_BUILD_DATE=\$(date -u +"%Y-%m-%dT%H:%M:%SZ")
                    export VITE_GIT_COMMIT="${env.GIT_COMMIT}"
                    npm run build
                    echo "Build done, dist size:"
                    du -sh dist || true
                    ls -lh dist || true
                """
                stash includes: 'dist/**', name: 'dist'
            }
            post {
                always {
                    archiveArtifacts artifacts: 'dist/**', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 7b. Validate Dockerfile Sync (guard drift)
        // Dockerfile (lokal, multi-stage) vs Dockerfile.deploy (Jenkins Plan A)
        // harus sync: base image, WORKDIR, EXPOSE, HEALTHCHECK, CMD, server.mjs.
        // ------------------------------------------
        stage('Validate Dockerfile Sync') {
            steps {
                echo 'Checking Dockerfile vs Dockerfile.deploy runtime sync...'
                sh """#!/bin/bash
                    set -euo pipefail
                    for f in Dockerfile Dockerfile.deploy; do
                        [ -f "\$f" ] || { echo "❌ missing \$f" >&2; exit 1; }
                    done
                    # join backslash continuations (HEALTHCHECK spans 2 lines), then pick directives
                    norm() { awk '{if (/\\\\\$/) {sub(/\\\\\$/," "); printf "%s",\$0; next} print}' "\$1" | grep -E '^(FROM|EXPOSE|HEALTHCHECK|CMD|WORKDIR)' || true; }
                    norm Dockerfile > .docker-base.txt
                    norm Dockerfile.deploy > .docker-deploy.txt
                    check() { # $1=label $2=pattern
                        a=\$(grep -E "^\$2" .docker-base.txt | tail -n 1 || true)
                        b=\$(grep -E "^\$2" .docker-deploy.txt | tail -n 1 || true)
                        # FROM: bandingkan image saja (abaikan 'AS build')
                        if [ "\$2" = "FROM" ]; then
                            a=\$(echo "\$a" | awk '{print \$2}')
                            b=\$(echo "\$b" | awk '{print \$2}')
                        fi
                        if [ -z "\$a" ] || [ -z "\$b" ]; then
                            echo "❌ \$1 hilang (base='\${a:-none}' deploy='\${b:-none}')" >&2
                            exit 1
                        fi
                        if [ "\$a" != "\$b" ]; then
                            echo "❌ drift \$1:" >&2
                            echo "  Dockerfile        : \$a" >&2
                            echo "  Dockerfile.deploy : \$b" >&2
                            exit 1
                        fi
                        echo "✅ \$1 sync: \$a"
                    }
                    check "FROM base image" "FROM"
                    check "WORKDIR" "WORKDIR"
                    check "EXPOSE" "EXPOSE"
                    check "HEALTHCHECK" "HEALTHCHECK"
                    check "CMD" "CMD"
                    grep -q 'server.mjs' Dockerfile || { echo "❌ Dockerfile tak copy server.mjs" >&2; exit 1; }
                    grep -q 'server.mjs' Dockerfile.deploy || { echo "❌ Dockerfile.deploy tak copy server.mjs" >&2; exit 1; }
                    echo "✅ server.mjs sync"
                """
            }
            post {
                always {
                    sh "rm -f .docker-base.txt .docker-deploy.txt || true"
                }
            }
        }

        // ------------------------------------------
        // 8. Docker Build & Push ke Harbor
        // ------------------------------------------
        stage('Docker Build & Push') {
            when { expression { env.DEPLOY_TARGET == 'staging' || env.DEPLOY_TARGET == 'production' } }
            steps {
                echo "Building Docker image: ${env.FULL_IMAGE}"

                // unstash dist untuk Plan A
                unstash 'dist'

                withCredentials([file(credentialsId: "${env.ENV_CRED}", variable: 'ENV_FILE')]) {
                    sh '''
                        set -euo pipefail
                        umask 077
                        cp "$ENV_FILE" .env
                        chmod 600 .env
                    '''
                }

                withCredentials([usernamePassword(
                    credentialsId: "${HARBOR_CREDENTIAL_ID}",
                    usernameVariable: 'HARBOR_USER',
                    passwordVariable: 'HARBOR_PASS'
                )]) {
                    sh """#!/bin/bash
set -euo pipefail
                        echo "\$HARBOR_PASS" | docker login ${HARBOR_HOST} -u "\$HARBOR_USER" --password-stdin

                        # Plan A: dist sudah dibuild + di-stash di stage Build,
                        # Dockerfile.deploy hanya COPY dist (tanpa rebuild).
                        # VITE_BUILD_DATE / VITE_GIT_COMMIT sudah dibake di stage Build.
                        if [ ! -d dist ]; then
                            echo "dist/ hilang setelah unstash — abort" >&2
                            exit 1
                        fi
                        docker build \
                            -f Dockerfile.deploy \
                            -t ${env.FULL_IMAGE} \
                            .

                        echo "=== trivy image scan (HIGH,CRITICAL block) via docker ==="
                        {
                            echo "# Trivy Image Report - ${env.FULL_IMAGE}"
                            echo ""
                            echo '```'
                            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:$TRIVY_VERSION image --severity HIGH,CRITICAL --format table --no-progress ${env.FULL_IMAGE} 2>&1 || true
                            echo '```'
                        } | tee trivy-image-report.md
                        docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:$TRIVY_VERSION image --severity HIGH,CRITICAL --exit-code 1 --no-progress ${env.FULL_IMAGE} || {
                            echo "❌ trivy image found HIGH/CRITICAL — blocking push" | tee -a trivy-image-report.md
                            docker image rm ${env.FULL_IMAGE} || true
                            docker logout ${HARBOR_HOST} || true
                            exit 1
                        }
                        echo "✅ trivy image passed" | tee -a trivy-image-report.md

                        docker push ${env.FULL_IMAGE}
                        docker logout ${HARBOR_HOST}
                    """
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'trivy-image-report.md', allowEmptyArchive: true
                    sh '''
                        rm -f .env || true
                        rm -rf dist || true
                    '''
                    // hapus image terbuild saja di agent (scoped, bukan prune -a)
                    sh "docker image rm ${env.FULL_IMAGE} || true"
                }
            }
        }

        // ------------------------------------------
        // 9. Approve Production Deploy
        // ------------------------------------------
        stage('Approve Production Deploy') {
            when { expression { env.DEPLOY_TARGET == 'production' } }
            steps {
                timeout(time: 60, unit: 'MINUTES') {
                    input(
                        id: 'approve-prod-deploy',
                        message: "Approve deploy ${env.IMAGE_TAG} ke PRODUCTION (${env.REMOTE_HOST})?",
                        ok: 'Approve Deploy',
                        submitter: 'admin, BU_EDU',
                        submitterParameter: 'APPROVER'
                    )
                }
                echo "Approved by: ${env.APPROVER ?: 'unknown'}"
            }
        }

        // ------------------------------------------
        // 10. Deploy (lock per-env Opsi C)
        // ------------------------------------------
        stage('Deploy') {
            when { expression { env.DEPLOY_TARGET == 'staging' || env.DEPLOY_TARGET == 'production' } }
            options {
                lock(resource: "onde-frontend-${env.DEPLOY_TARGET}")
            }
            steps {
                sshagent(["${env.SSH_CRED}"]) {

                    echo "Deploying to ${env.DEPLOY_TARGET} with lock onde-frontend-${env.DEPLOY_TARGET}..."
                    sh """#!/bin/bash
set -euo pipefail
                        mkdir -p ~/.ssh
                        chmod 700 ~/.ssh
                        # StrictHostKeyChecking accept-new (lebih aman dari blind append)
                        if [ ! -f ~/.ssh/known_hosts ] || ! ssh-keygen -F ${REMOTE_HOST} >/dev/null 2>&1; then
                            ssh-keyscan -H ${REMOTE_HOST} >> ~/.ssh/known_hosts 2>/dev/null || true
                        fi
                        chmod 600 ~/.ssh/known_hosts || true
                        ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ${REMOTE_USER}@${REMOTE_HOST} 'mkdir -p ${REMOTE_DIR} && rm -f ${REMOTE_DIR}/.env && docker network create palpatrol 2>/dev/null || true'
                    """

                    echo 'Transferring files (.env & docker-compose.yml)...'
                    sh "scp -o StrictHostKeyChecking=accept-new docker-compose.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/docker-compose.yml"
                    withCredentials([file(credentialsId: "${env.ENV_CRED}", variable: 'ENV_FILE')]) {
                        sh """#!/bin/bash
set -euo pipefail
                            umask 077
                            cat \$ENV_FILE > .env.tmp
                            echo "FULL_IMAGE=${env.FULL_IMAGE}" >> .env.tmp
                            echo "CONTAINER_NAME=${env.CONTAINER_NAME}" >> .env.tmp
                            echo "HOST_BIND=${env.HOST_BIND}" >> .env.tmp
                            echo "HOST_PORT=${env.HOST_PORT}" >> .env.tmp
                            echo "CONTAINER_PORT=${env.CONTAINER_PORT}" >> .env.tmp
                            echo "HEALTH_CHECK_PORT=${env.HEALTH_CHECK_PORT}" >> .env.tmp
                            chmod 600 .env.tmp
                            scp -o StrictHostKeyChecking=accept-new .env.tmp ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.env
                            rm -f .env.tmp
                        """
                    }

                    echo "Pulling image and restarting containers on remote..."
                    withCredentials([usernamePassword(
                        credentialsId: "${HARBOR_CREDENTIAL_ID}",
                        usernameVariable: 'HARBOR_USER',
                        passwordVariable: 'HARBOR_PASS'
                    )]) {
                        sh """#!/bin/bash
set -euo pipefail
                            CRED_FILE=\$(mktemp)
                            trap 'rm -f "\$CRED_FILE"' EXIT
                            umask 077
                            printf 'HARBOR_USER=%s\\nHARBOR_PASS=%s\\n' "\$HARBOR_USER" "\$HARBOR_PASS" > "\$CRED_FILE"

                            scp -q -o StrictHostKeyChecking=accept-new "\$CRED_FILE" ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.harbor_cred
                            ssh -o StrictHostKeyChecking=accept-new ${REMOTE_USER}@${REMOTE_HOST} "chmod 600 ${REMOTE_DIR}/.harbor_cred"
                        """

                        sh """#!/bin/bash
set -euo pipefail
                            ssh -o StrictHostKeyChecking=accept-new ${REMOTE_USER}@${REMOTE_HOST} "HARBOR_HOST='${HARBOR_HOST}' FULL_IMAGE='${env.FULL_IMAGE}' REMOTE_DIR='${env.REMOTE_DIR}' CONTAINER_NAME='${env.CONTAINER_NAME}' HOST_BIND='${env.HOST_BIND}' HOST_PORT='${env.HOST_PORT}' CONTAINER_PORT='${env.CONTAINER_PORT}' HEALTH_CHECK_PORT='${env.HEALTH_CHECK_PORT}' HARBOR_PROJECT='${env.HARBOR_PROJECT}' IMAGE_NAME='${env.IMAGE_NAME}' bash -s" << 'EOF'
                                set -euo pipefail
                                trap 'rm -f "\$REMOTE_DIR/.harbor_cred"' EXIT

                                source "\$REMOTE_DIR/.harbor_cred"
                                echo "\$HARBOR_PASS" | docker login "\$HARBOR_HOST" -u "\$HARBOR_USER" --password-stdin
                                unset HARBOR_PASS HARBOR_USER

                                cd "\$REMOTE_DIR"

                                # Simpan prev FULL_IMAGE tag untuk rollback auto (60s)
                                if docker inspect "\$CONTAINER_NAME" >/dev/null 2>&1; then
                                    PREV_TAG=\$(docker inspect --format='{{.Config.Image}}' "\$CONTAINER_NAME" 2>/dev/null || echo "")
                                    if [ -n "\$PREV_TAG" ] && [ "\$PREV_TAG" != "\$FULL_IMAGE" ]; then
                                        echo "\$PREV_TAG" > .prev_image_tag
                                        echo "Prev tag saved: \$PREV_TAG"
                                    else
                                        echo "No prev tag to save (first deploy or same tag)"
                                    fi
                                    PREV_ID=\$(docker inspect --format='{{.Image}}' "\$CONTAINER_NAME" 2>/dev/null || echo "")
                                    [ -n "\$PREV_ID" ] && echo "\$PREV_ID" > .prev_image || true
                                fi

                                docker pull "\$FULL_IMAGE"

                                export FULL_IMAGE="\$FULL_IMAGE"
                                export CONTAINER_NAME="\$CONTAINER_NAME"
                                export HOST_BIND="\${HOST_BIND:-127.0.0.1}"
                                export HOST_PORT="\${HOST_PORT:-13015}"
                                export CONTAINER_PORT="\${CONTAINER_PORT:-80}"
                                export HEALTH_CHECK_PORT="\${HEALTH_CHECK_PORT:-\$HOST_PORT}"
                                if command -v docker-compose >/dev/null 2>&1; then
                                    docker-compose up -d --no-build
                                else
                                    docker compose up -d --no-build
                                fi

                                docker logout "\$HARBOR_HOST"

                                echo "Cleaning up dangling images only (scoped, bukan -a)..."
                                docker image prune -f --filter "dangling=true" || true
                                # keep last 3 tags of this image only
                                KEEP=3
                                IDS=\$(docker images "${HARBOR_HOST}/${HARBOR_PROJECT}/${IMAGE_NAME}" --format "{{.ID}} {{.CreatedAt}}" | sort -k2 -r | tail -n +\$(expr \$KEEP + 1) | awk '{print \$1}' || true)
                                if [ -n "\$IDS" ]; then
                                    echo "Removing old images: \$IDS"
                                    echo "\$IDS" | xargs -r docker rmi -f || true
                                fi
EOF
                        """
                    }
                }
            }
        }

        // ------------------------------------------
        // 11. Health Check (lock per-env Opsi C)
        // ------------------------------------------
        stage('Health Check') {
            when { expression { env.DEPLOY_TARGET == 'staging' || env.DEPLOY_TARGET == 'production' } }
            options {
                lock(resource: "onde-frontend-${env.DEPLOY_TARGET}")
            }
            steps {
                sshagent(["${env.SSH_CRED}"]) {
                    sh """
                        ssh -o StrictHostKeyChecking=accept-new ${REMOTE_USER}@${REMOTE_HOST} "REMOTE_DIR='${env.REMOTE_DIR}' FULL_IMAGE='${env.FULL_IMAGE}' HEALTH_CHECK_PORT='${env.HEALTH_CHECK_PORT}' CONTAINER_NAME='${env.CONTAINER_NAME}' HARBOR_HOST='${env.HARBOR_HOST}' bash -s" << 'EOF'
                            set -uo pipefail

                            COMPOSE_CMD="docker compose"
                            if command -v docker-compose >/dev/null 2>&1; then
                                COMPOSE_CMD="docker-compose"
                            fi

                            echo "Health check: max 60s (12x5s) — Docker HEALTHCHECK + inner + host"
                            HEALTH_OK=0
                            for i in \$(seq 1 12); do
                                echo "--- attempt \$i/12 (\$((i*5))s) ---"

                                # 1. Docker HEALTHCHECK status (source truth dari Dockerfile:17)
                                HSTATUS=\$(docker inspect --format='{{.State.Health.Status}}' "\$CONTAINER_NAME" 2>/dev/null || echo "none")
                                if [ "\$HSTATUS" = "healthy" ]; then
                                    echo "Docker HEALTHCHECK healthy"
                                    HEALTH_OK=1
                                    break
                                fi

                                # 2. Compose running
                                if ! \$COMPOSE_CMD -f "\$REMOTE_DIR/docker-compose.yml" ps 2>/dev/null | grep -Eq "Up|running"; then
                                    echo "Container not running (ps check fail)"
                                else
                                    # 3a. Inner check (bypass host port mapping)
                                    if docker exec "\$CONTAINER_NAME" wget -qO- http://127.0.0.1/health 2>/dev/null | grep -q "ok"; then
                                        echo "Inner wget /health ok"
                                        HEALTH_OK=1
                                        break
                                    fi
                                    # 3b. Host port check (docker-compose.yml ports)
                                    if curl -sf --max-time 3 --connect-timeout 3 "http://127.0.0.1:\$HEALTH_CHECK_PORT/health" 2>/dev/null | grep -q "ok"; then
                                        echo "Host curl /health ok (port \$HEALTH_CHECK_PORT)"
                                        HEALTH_OK=1
                                        break
                                    fi
                                    echo "Health not ready (HSTATUS=\$HSTATUS) — retry in 5s"
                                fi

                                if [ \$i -eq 12 ]; then
                                    echo "Health timeout 60s reached"
                                    break
                                fi
                                sleep 5
                            done

                            if [ "\$HEALTH_OK" -eq 1 ]; then
                                echo "Health check passed!"
                                # verify SPA index also
                                curl -sf --max-time 3 "http://127.0.0.1:\$HEALTH_CHECK_PORT/" >/dev/null 2>&1 && echo "SPA index ok" || echo "SPA index warn (non-blocking)"
                                rm -f "\$REMOTE_DIR/.prev_image" "\$REMOTE_DIR/.prev_image_tag" || true
                                exit 0
                            fi

                            echo "Health check FAILED after 60s — container logs:"
                            docker logs --tail 100 "\$CONTAINER_NAME" 2>/dev/null || true
                            echo "--- inspect Health ---"
                            docker inspect --format='{{json .State.Health}}' "\$CONTAINER_NAME" 2>/dev/null | head -c 1000 || true
                            echo ""

                            # Auto rollback to prev tag (60s feature)
                            if [ -f "\$REMOTE_DIR/.prev_image_tag" ]; then
                                PREV_TAG=\$(cat "\$REMOTE_DIR/.prev_image_tag")
                                echo "Auto rollback to: \$PREV_TAG"
                                if [ -n "\$PREV_TAG" ]; then
                                    echo "\$PREV_TAG" | grep -q "/" && docker pull "\$PREV_TAG" 2>/dev/null || true
                                    # rollback via env override
                                    FULL_IMAGE="\$PREV_TAG" CONTAINER_NAME="\$CONTAINER_NAME" HEALTH_CHECK_PORT="\$HEALTH_CHECK_PORT" \$COMPOSE_CMD -f "\$REMOTE_DIR/docker-compose.yml" up -d --no-build 2>/dev/null || \\
                                        docker run -d --name "\$CONTAINER_NAME-rollback" -p "127.0.0.1:\$HEALTH_CHECK_PORT:80" "\$PREV_TAG" 2>/dev/null || true
                                    echo "Rollback triggered, waiting 10s for prev container..."
                                    sleep 10
                                    if docker exec "\$CONTAINER_NAME" wget -qO- http://127.0.0.1/health 2>/dev/null | grep -q "ok" || curl -sf --max-time 3 "http://127.0.0.1:\$HEALTH_CHECK_PORT/health" 2>/dev/null | grep -q "ok"; then
                                        echo "Rollback health ok — new deploy marked failed but service restored"
                                    else
                                        echo "Rollback health also failed — manual intervention needed"
                                    fi
                                fi
                            else
                                echo "No .prev_image_tag found — skip rollback (first deploy?)"
                            fi

                            exit 1
EOF
                    """
                }
            }
        }
    }

    post {
        success {
            script {
                if (env.DEPLOY_TARGET == 'staging' || env.DEPLOY_TARGET == 'production') {
                    echo "✅ Deployment ${env.IMAGE_TAG} berhasil ke ${env.DEPLOY_TARGET.toUpperCase()} (${env.REMOTE_HOST}) container ${env.CONTAINER_NAME}"
                } else {
                    echo "✅ Build & Test berhasil untuk branch '${env.BRANCH_NAME}' (tanpa deploy)."
                }
            }
        }
        failure {
            echo "❌ Pipeline gagal di branch '${env.BRANCH_NAME}'. Cek log: ${env.BUILD_URL}"
        }
        cleanup {
            sh "docker logout ${HARBOR_HOST} || true"
            // keep md reports as artifacts, cleanup only temp
            archiveArtifacts artifacts: 'lint-report.md,type-check-report.md,unit-test-report.md,npm-audit-report.md,trivy-fs-report.md,trivy-image-report.md,npm-audit.json', allowEmptyArchive: true
            sh "rm -f .env .env.tmp junit.xml || true"
            // cleanWs optional — uncomment jika ingin hapus workspace tiap build
            // cleanWs()
        }
    }
}
