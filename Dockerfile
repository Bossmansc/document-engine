# Stage 1: Build the Frontend (Node.js)
FROM node:18-alpine as frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Setup the Backend (Python)
FROM python:3.11-slim
WORKDIR /app

# Copy Backend files
COPY backend/ ./backend/

# Copy Built Frontend from Stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Install Python Dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Expose Port
ENV PORT=8000
EXPOSE 8000

# Start the Server
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"]
