FROM python:3.12-slim
WORKDIR /workspace/caveworkers
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONPATH=/workspace
USER 10001
EXPOSE 8080
CMD ["waitress-serve", "--port=8080", "caveworkers.app:app"]
