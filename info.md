ECS Express Mode Deployment — Rubab 1 / 8
Role Focus
Application code preparation, Dockerfile creation, initial container image push to ECR, and GitHub Actions workflow
setup. Tasks split into three blocks with clear dependencies on Haris's AWS infrastructure work.
Pre-Deployment Decisions Required
Before starting any task, confirm the following with Haris:
1 Node.js entry file name (e.g., index.js , server.js , app.js )
2 Current app port number (e.g., 3000, 8080)
3 Environment variables list (DB URLs, API keys, secrets)
4 GitHub repository name and owner
5 Credentials sharing method for Phase 3 (secure channel)
Block 1 — Code Preparation
DEPLOYMENT PLAYBOOK
Rubab's Tasks
ECS Express Mode Deployment · Application Code & GitHub Configuration
Brandscaling Backend Migration AWS 802749364652 · us-east-1 90–120 minutes
PROJECT ACCOUNT EST. TIME
ECS Express Mode Deployment — Rubab 2 / 8
Block 1 · Application Code Setup ~30–60 min · Standalone
✓ Can start immediately after Decisions #1, #2 confirmed
A1 Update main entry file — bind server to 0.0.0.0 and use process.env.PORT || 8080
A2 Add /health GET endpoint returning {"status":"ok"}
A3 Create Dockerfile in repository root (template below)
A4 Create .dockerignore in repository root (template below)
A5 Run docker build -t backend-test . locally
A6 Run docker run -p 8080:8080 backend-test and verify localhost:8080/health responds
A7 Create branch feat/ecs-express-deployment , commit files, push to GitHub
A8 Notify Haris: "Code prep complete, branch pushed"
Port Binding Code (Task A1)
const port = process.env.PORT || 8080;
app.listen(port, '0.0.0.0', () => {
 console.log(`Server running on port ${port}`);
});
CRITICAL
Must bind to 0.0.0.0 , NOT localhost or 127.0.0.1 . Containers cannot route traffic from localhost.
Dockerfile Template (Task A3)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 8080
CMD ["node", "index.js"]
NOTE
ECS Express Mode Deployment — Rubab 3 / 8
Replace index.js with actual entry file name if different. Update EXPOSE and CMD port to match the app port.
.dockerignore Template (Task A4)
node_modules
npm-debug.log
.git
.gitignore
.env
.env.local
.env.*.local
.DS_Store
README.md
.github
*.md
coverage
.nyc_output
.vscode
Health Endpoint Code (Task A2)
app.get('/health', (req, res) => {
 res.status(200).json({ status: 'ok' });
});
WHY THIS MATTERS
ECS uses this endpoint to verify container health. Without it, ECS uses / which may fail for API-only backends.
ECS Express Mode Deployment — Rubab 4 / 8
Block 2 — Initial Image Push
Block 2 · Docker Build & Push to ECR ~15–20 min · Dependent
⚠ Cannot start until Haris completes his Block 1 (ECR + IAM + credentials)
A9 Receive AWS credentials from Haris via secure channel
A10 Authenticate Docker to ECR using aws ecr get-login-password
A11 Build image: docker build -t amiqus-faq-allianz .
A12 Tag image with full ECR URI
A13 Push image: docker push [ECR-URI]:latest
A14 Notify Haris: "Initial image pushed"
Docker Authentication Command (Task A10)
aws ecr get-login-password --region us-east-1 | \
 docker login --username AWS --password-stdin \
 802749364652.dkr.ecr.us-east-1.amazonaws.com
Expected output: Login Succeeded
Build, Tag, Push Sequence (Tasks A11–A13)
# Build
docker build -t amiqus-faq-allianz .
# Tag
docker tag amiqus-faq-allianz:latest \
 802749364652.dkr.ecr.us-east-1.amazonaws.com/amiqus-faq-allianz:latest
# Push
docker push \
 802749364652.dkr.ecr.us-east-1.amazonaws.com/amiqus-faq-allianz:latest
TIMING
First push may take 3–10 minutes depending on image size and network speed.
Block 3 — GitHub Actions Setup
ECS Express Mode Deployment — Rubab 5 / 8
Block 3 · Auto-Deploy Workflow Configuration ~30–45 min · Dependent
⚠ Cannot start until Haris completes GitHub OIDC + role (his Block 3)
A15 Receive from Haris: cluster name, service name, role ARN
A16 Add 5 GitHub repository variables (table below)
A17 Create .github/workflows/deploy.yml
A18 Commit workflow file to feat/ecs-express-deployment branch
A19 Wait for Haris confirmation that ECS service URL test passed
A20 Merge feat/ecs-express-deployment to main branch
A21 Monitor GitHub Actions tab — confirm workflow runs successfully
A22 Make trivial code change, push to main, verify auto-deploy works
GitHub Repository Variables (Task A16)
Location: GitHub repo → Settings → Secrets and variables → Actions → Variables tab
VARIABLE NAME VALUE
AWS_REGION us-east-1
AWS_ACCOUNT_ID 802749364652
ECR_REPOSITORY amiqus-faq-allianz
ECS_SERVICE amiqus-faq-allianz-service
ECS_CLUSTER (from Haris — provided in handoff #3)
ECS Express Mode Deployment — Rubab 6 / 8
GitHub Actions Workflow (Task A17)
Create file: .github/workflows/deploy.yml
name: Build and Deploy to ECS Express Mode
on:
 push:
 branches: [ main ]
env:
 AWS_REGION: ${{ vars.AWS_REGION }}
 AWS_ACCOUNT_ID: ${{ vars.AWS_ACCOUNT_ID }}
 ECR_REPOSITORY: ${{ vars.ECR_REPOSITORY }}
 ECS_SERVICE: ${{ vars.ECS_SERVICE }}
 ECS_CLUSTER: ${{ vars.ECS_CLUSTER }}
jobs:
 deploy:
 name: Deploy
 runs-on: ubuntu-latest
 permissions:
 id-token: write
 contents: read
 steps:
 - name: Checkout
 uses: actions/checkout@v6
 - name: Configure AWS credentials
 uses: aws-actions/configure-aws-credentials@v5
 with:
 aws-region: ${{ env.AWS_REGION }}
 role-to-assume: arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/github-actions-ecs-role
 role-session-name: GitHubActionsECSDeployment
 - name: Login to Amazon ECR
 id: login-ecr
 uses: aws-actions/amazon-ecr-login@v2
 - name: Get short commit hash
 run: echo "IMAGE_TAG=${GITHUB_SHA:0:7}" >> $GITHUB_ENV
 - name: Build, tag, and push image to Amazon ECR
 env:
 ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
 uses: docker/build-push-action@v6
 with:
 context: .
 push: true
 tags: ${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:latest,${{ env.ECR_REGISTRY }}
 - name: Deploy to ECS Express Mode
ECS Express Mode Deployment — Rubab 7 / 8
 uses: aws-actions/amazon-ecs-deploy-express-service@v1
 env:
 ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
 with:
 service-name: ${{ env.ECS_SERVICE }}
 image: ${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:${{ env.IMAGE_TAG }}
 execution-role-arn: arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/ecsTaskExecutionRole
 infrastructure-role-arn: arn:aws:iam::${{ env.AWS_ACCOUNT_ID }}:role/ecsInfrastructure
 cluster: ${{ env.ECS_CLUSTER }}
 container-port: 8080
 cpu: '1024'
 memory: '2048'
 health-check-path: /health
 min-task-count: 1
 max-task-count: 4
 auto-scaling-metric: AVERAGE_CPU
 auto-scaling-target-value: 70
Handoffs With Haris
← RECEIVE from Haris (after his Block 1)
AWS credentials for ECR push + ECR URI confirmation
"AWS foundation ready. ECR repo amiqus-faq-allianz created. Credentials sent via
[secure method]."
→ SEND to Haris (after Block 2)
Notification that image is in ECR
"Image `latest` pushed to ECR. Ready for ECS service creation."
← RECEIVE from Haris (after his Block 2 + 3)
Resource details needed for GitHub variables and workflow
"ECS running. Cluster: [name], Service: [name], Role ARN: [arn]. ALB URL test passed."
→ SEND to Haris (after Block 3)
Workflow committed, ready for merge approval
"Workflow committed to branch. Ready to merge?"
Success Criteria
Dockerfile builds successfully locally
ECS Express Mode Deployment — Rubab 8 / 8
Container responds on /health endpoint
Initial image visible in ECR console
GitHub Actions workflow file exists in repo
Push to main triggers automated build and deploy
New code change deploys without manual intervention
Document version 1.0 · Generated for Mohammed Haris Khan · ECS Express Mode Migration Plan
Refer to Haris's document for parallel infrastructure tasks and full deployment context.