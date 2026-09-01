pipeline {
    agent any

    triggers {
        githubPush()
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    environment {
        // ==========================================
        // Harbor Registry
        // ==========================================
        HARBOR_CREDENTIAL_ID = 'harbor-registry-creds'
        HARBOR_HOST          = 'registry.solu.co.id'
        HARBOR_PROJECT       = 'gdevelop'
        IMAGE_NAME           = 'gdevelop-web-poc'

        // ==========================================
        // Staging Server Credentials
        // (disimpan di Jenkins Credential Domain: server-staging)
        // Sesuaikan ID di bawah dengan ID asli yang kamu buat di Jenkins.
        // ==========================================
        SSH_CREDENTIAL_ID = 'ssh-remote-staging'
        ENV_CREDENTIAL_ID = 'gdevelop-web-poc-env-staging'

        // ==========================================
        // Staging Server Remote dir & App Port
        // REMOTE_DIR memakai STAGING_BASE_DIR dari Jenkins Global Environment,
        // APP_PORT spesifik untuk app ini (port yang di-expose Nginx container).
        // ==========================================
        REMOTE_DIR = "${STAGING_BASE_DIR}/gdevelop-web-poc"
        APP_PORT   = '18530'
    }

    stages {

        // ------------------------------------------
        // 1. Checkout
        // ------------------------------------------
        stage('Checkout') {
            steps {
                echo "Checking out branch: ${env.BRANCH_NAME ?: env.GIT_BRANCH ?: 'detected branch'}"
                checkout scm

                script {
                    def version = readFile('VERSION').trim()
                    if (!version.startsWith('v')) {
                        error "Format VERSION tidak valid: ${version}. Gunakan semantic versioning (contoh: v1.0.0)"
                    }
                    env.IMAGE_TAG = "staging-${version}-${env.BUILD_NUMBER}"
                    env.FULL_IMAGE = "${env.HARBOR_HOST}/${env.HARBOR_PROJECT}/${env.IMAGE_NAME}:${env.IMAGE_TAG}"
                    echo "Version: ${version} | Full Image: ${env.FULL_IMAGE}"
                }
            }
        }

        // ------------------------------------------
        // 2. Resolve Staging Server Config
        //    Deploy hanya untuk branch 'staging'.
        //    Branch lain tetap build & test, tapi tidak deploy
        //    (karena saat ini baru ada server staging).
        // ------------------------------------------
        stage('Resolve Environment') {
            steps {
                script {
                    if (env.BRANCH_NAME != 'staging') {
                        echo "Branch '${env.BRANCH_NAME}' bukan 'staging'."
                        echo "Hanya menjalankan Build & Test, tanpa Docker push / deploy."
                        env.DEPLOY_TARGET = 'none'
                        return
                    }

                    env.DEPLOY_TARGET = 'staging'
                    env.REMOTE_USER   = env.STAGING_REMOTE_USER
                    env.REMOTE_HOST   = env.STAGING_REMOTE_HOST

                    if (!env.REMOTE_HOST || !env.REMOTE_USER) {
                        error "STAGING_REMOTE_USER/HOST belum lengkap diset di Jenkins Global Environment Variables."
                    }

                    echo "Deploy target : staging"
                    echo "Full image    : ${env.FULL_IMAGE}"
                    echo "Remote target : ${env.REMOTE_USER}@${env.REMOTE_HOST}:${env.REMOTE_DIR}"
                }
            }
        }

        // ------------------------------------------
        // 3. Install, Lint & Build (selalu jalan, semua branch)
        //    Jalan di agent Docker node:20-alpine.
        //    NOTE: 'set -o pipefail' aman di sini karena BusyBox ash
        //    di Alpine mendukungnya. TIDAK perlu shebang #!/bin/bash.
        //
        //    Gunakan `npm ci` (bukan `npm install`) supaya konsisten
        //    dengan package-lock.json. Ganti perintah lint/test/build
        //    sesuai package.json project (contoh di bawah pakai skrip
        //    umum: lint, test:unit, build).
        // ------------------------------------------
        stage('Install, Lint & Build') {
            agent {
                docker {
                    image 'node:22-alpine'
                    reuseNode true
                }
            }
            environment {
                // Arahkan cache npm ke dalam workspace (bukan /.npm di root
                // filesystem container). Ini menghindari error EACCES/root-owned
                // cache yang muncul karena container jalan sebagai root tapi
                // ownership /.npm tidak konsisten antar-run/antar-container.
                npm_config_cache = "${WORKSPACE}/.npm-cache"
            }
            steps {
                echo 'Installing dependencies & building Vue app...'
                sh '''
                    set -euo pipefail

                    # Bersihkan node_modules lama sebelum install.
                    # Mencegah error ENOTEMPTY/TAR_ENTRY_ERROR saat npm ci
                    # mencoba menghapus/menimpa node_modules hasil build sebelumnya
                    # yang kondisinya sudah tidak konsisten.
                    rm -rf node_modules

                    npm ci
                    npm run lint --if-present
                    npm run test:unit --if-present -- --run
                    npm run build
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'dist/**', allowEmptyArchive: true
                }
            }
        }

        // ------------------------------------------
        // 4. Docker Build & Push ke Harbor
        //    Jalan di 'agent any' (node Jenkins utama).
        //    Dockerfile diasumsikan multi-stage: build dengan node,
        //    lalu serve hasil build (dist/) dengan nginx.
        //    Default /bin/sh di kebanyakan node Linux (Debian/Ubuntu)
        //    adalah dash, yang TIDAK mendukung 'pipefail' -> perlu
        //    shebang #!/bin/bash agar Jenkins pakai bash, bukan dash.
        //
        //    ENV INJECTION: file .env (Secret File Jenkins, ENV_CREDENTIAL_ID)
        //    disalin ke root build context SEBELUM `docker build` dijalankan.
        //    Ini penting untuk app Vue/Vite: env var di-embed ke bundle JS
        //    pada saat `npm run build` di dalam image, jadi harus tersedia
        //    saat image di-build -- bukan cuma saat container jalan di
        //    staging. Pastikan Dockerfile meng-COPY .env sebelum build step
        //    (mis. `COPY . .` sebelum `RUN npm run build`), dan .env di-hapus
        //    lagi di blok post{} supaya tidak numpuk di workspace Jenkins.
        // ------------------------------------------
        stage('Docker Build & Push') {
            when { expression { env.DEPLOY_TARGET == 'staging' } }
            steps {
                echo "Building Docker image: ${env.FULL_IMAGE}"

                withCredentials([file(credentialsId: "${ENV_CREDENTIAL_ID}", variable: 'ENV_FILE')]) {
                    sh 'cp "$ENV_FILE" .env'
                }

                withCredentials([usernamePassword(
                    credentialsId: "${HARBOR_CREDENTIAL_ID}",
                    usernameVariable: 'HARBOR_USER',
                    passwordVariable: 'HARBOR_PASS'
                )]) {
                    sh """#!/bin/bash
set -euo pipefail
                        echo "\$HARBOR_PASS" | docker login ${HARBOR_HOST} -u "\$HARBOR_USER" --password-stdin

                        docker build \
                            --build-arg BUILD_DATE=\$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
                            --build-arg GIT_COMMIT=${env.GIT_COMMIT} \
                            -t ${env.FULL_IMAGE} \
                            .

                        docker push ${env.FULL_IMAGE}
                        docker logout ${HARBOR_HOST}
                    """
                }
            }
            post {
                always {
                    sh "rm -f .env"
                    sh "docker image rm ${env.FULL_IMAGE} || true"
                }
            }
        }

        // ------------------------------------------
        // 5. Deploy ke Staging Server
        //    Sama seperti stage sebelumnya, jalan di 'agent any',
        //    semua blok sh dengan 'pipefail' perlu shebang #!/bin/bash.
        //    Bagian yang dieksekusi di REMOTE server via heredoc
        //    << 'EOF' sudah dipaksa pakai 'bash -s' jadi aman, TIDAK
        //    perlu shebang tambahan di dalam heredoc itu.
        // ------------------------------------------
        stage('Deploy to Staging') {
            when { expression { env.DEPLOY_TARGET == 'staging' } }
            steps {
                sshagent(["${SSH_CREDENTIAL_ID}"]) {

                    echo 'Preparing remote server...'
                    sh """#!/bin/bash
set -euo pipefail
                        mkdir -p ~/.ssh
                        ssh-keyscan -H ${REMOTE_HOST} >> ~/.ssh/known_hosts 2>/dev/null || true
                        ssh ${REMOTE_USER}@${REMOTE_HOST} 'mkdir -p ${REMOTE_DIR} && rm -f ${REMOTE_DIR}/.env'
                    """

                    echo 'Transferring files (.env & docker-compose.yml)...'
                    sh "scp docker-compose.yml ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/docker-compose.yml"
                    withCredentials([file(credentialsId: "${ENV_CREDENTIAL_ID}", variable: 'ENV_FILE')]) {
                        sh """#!/bin/bash
set -euo pipefail
                            cat \$ENV_FILE > .env.tmp
                            echo "FULL_IMAGE=${env.FULL_IMAGE}" >> .env.tmp
                            scp .env.tmp ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.env
                            rm -f .env.tmp
                        """
                    }

                    echo "Pulling image and restarting containers on remote..."
                    withCredentials([usernamePassword(
                        credentialsId: "${HARBOR_CREDENTIAL_ID}",
                        usernameVariable: 'HARBOR_USER',
                        passwordVariable: 'HARBOR_PASS'
                    )]) {
                        // Kredensial Harbor dikirim lewat file sementara (chmod 600) via scp,
                        // BUKAN lewat argumen command SSH — mencegah password terlihat di `ps aux`
                        // baik di Jenkins agent maupun di remote server.
                        sh """#!/bin/bash
set -euo pipefail
                            CRED_FILE=\$(mktemp)
                            trap 'rm -f "\$CRED_FILE"' EXIT
                            umask 077
                            printf 'HARBOR_USER=%s\\nHARBOR_PASS=%s\\n' "\$HARBOR_USER" "\$HARBOR_PASS" > "\$CRED_FILE"

                            scp -q "\$CRED_FILE" ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.harbor_cred
                            ssh ${REMOTE_USER}@${REMOTE_HOST} "chmod 600 ${REMOTE_DIR}/.harbor_cred"
                        """

                        sh """#!/bin/bash
set -euo pipefail
                            ssh ${REMOTE_USER}@${REMOTE_HOST} "HARBOR_HOST='${HARBOR_HOST}' FULL_IMAGE='${env.FULL_IMAGE}' REMOTE_DIR='${env.REMOTE_DIR}' bash -s" << 'EOF'
                                set -euo pipefail
                                trap 'rm -f "\$REMOTE_DIR/.harbor_cred"' EXIT

                                # shellcheck disable=SC1091
                                source "\$REMOTE_DIR/.harbor_cred"
                                echo "\$HARBOR_PASS" | docker login "\$HARBOR_HOST" -u "\$HARBOR_USER" --password-stdin
                                unset HARBOR_PASS HARBOR_USER

                                cd "\$REMOTE_DIR"

                                docker pull "\$FULL_IMAGE"

                                export FULL_IMAGE="\$FULL_IMAGE"
                                if command -v docker-compose >/dev/null 2>&1; then
                                    docker-compose up -d --no-build
                                else
                                    docker compose up -d --no-build
                                fi

                                docker logout "\$HARBOR_HOST"

                                echo "Cleaning up old images..."
                                docker image prune -a -f --filter "until=24h"
EOF
                        """
                    }
                }
            }
        }

        // ------------------------------------------
        // 6. Health Check
        //    Skip jika bukan branch staging.
        //    Karena ini frontend statis di balik Nginx, cukup cek
        //    container jalan dan halaman root dapat diakses (200 OK).
        //    Sesuaikan path health-check jika app punya endpoint
        //    khusus (mis. /healthz) yang di-serve Nginx.
        // ------------------------------------------
        stage('Health Check') {
            when { expression { env.DEPLOY_TARGET == 'staging' } }
            steps {
                sshagent(["${SSH_CREDENTIAL_ID}"]) {
                    sh """
                        ssh ${REMOTE_USER}@${REMOTE_HOST} "REMOTE_DIR='${env.REMOTE_DIR}' APP_PORT='${env.APP_PORT}' bash -s" << 'EOF'
                            set -uo pipefail
                            echo "Waiting for container to be ready..."
                            sleep 10

                            if command -v docker-compose >/dev/null 2>&1; then
                                docker-compose -f "\$REMOTE_DIR/docker-compose.yml" ps | grep -E "Up|running" || {
                                    echo "Container tidak running!"; exit 1
                                }
                            else
                                docker compose -f "\$REMOTE_DIR/docker-compose.yml" ps | grep -E "Up|running" || {
                                    echo "Container tidak running!"; exit 1
                                }
                            fi

                            curl -sf --retry 3 --retry-delay 5 "http://127.0.0.1:\$APP_PORT/health" || {
                                echo "Health check gagal!"; exit 1
                            }

                            echo "Health check passed!"
EOF
                    """
                }
            }
        }
    }

    post {
        success {
            script {
                if (env.DEPLOY_TARGET == 'staging') {
                    echo "✅ Deployment ${env.IMAGE_TAG} berhasil ke STAGING (${env.REMOTE_HOST})"
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
        }
    }
}
