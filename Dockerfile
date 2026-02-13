FROM mcr.microsoft.com/playwright/python:v1.54.0-jammy

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY . /app

RUN mkdir -p /data

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000 1455

ENTRYPOINT ["/entrypoint.sh"]
CMD ["serve"]
