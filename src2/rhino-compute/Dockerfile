# ==============================================================================
# Rhino Compute on Linux Container
# Official McNeel Guide: https://developer.rhino3d.com/guides/compute/compute-linux-getting-started/
# Base OS: Ubuntu 24.04 LTS (Noble Numbat)
# ==============================================================================

FROM --platform=linux/amd64 ubuntu:noble

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# 1. Install system utilities and network tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    gnupg \
    procps \
    nano \
    findutils \
    libgdiplus \
    fontconfig \
    libicu-dev \
    libssl-dev \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Microsoft .NET 9.0.102 (McNeel official requirement)
RUN wget https://dotnet.microsoft.com/download/dotnet/scripts/v1/dotnet-install.sh -O dotnet-install.sh && \
    chmod +x ./dotnet-install.sh && \
    ./dotnet-install.sh --version 9.0.102 --install-dir /usr/share/dotnet && \
    ln -s /usr/share/dotnet/dotnet /usr/bin/dotnet && \
    rm -f dotnet-install.sh

# 3. Add McNeel Official Package Repository (S3)
RUN wget -qO- https://mcneel-packages.s3.amazonaws.com/mcneel-packages.gpg.key | gpg --dearmor -o /usr/share/keyrings/mcneel-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/mcneel-archive-keyring.gpg] https://mcneel-packages.s3.amazonaws.com/deb stable main" | tee /etc/apt/sources.list.d/mcneel.list

# 4. Install rhino-compute and yak-cli
RUN apt-get update && apt-get install -y --no-install-recommends \
    rhino-compute \
    yak-cli \
    && rm -rf /var/lib/apt/lists/*

# 4b. Patch headless Linux native C++ issues in McNeel libraries
COPY patch_mcneel.py /tmp/patch_mcneel.py
RUN python3 /tmp/patch_mcneel.py && rm -f /tmp/patch_mcneel.py

# 5. Install Grasshopper plugins via McNeel Yak package manager
RUN yak install Miller_Moth \
    && runuser -u rhino-compute -- yak install Miller_Moth \
    && mkdir -p /var/lib/rhino-compute/.config/Grasshopper/Libraries /root/.config/Grasshopper/Libraries \
    && find / -name "MillerMoth.gha" -exec cp -n {} /var/lib/rhino-compute/.config/Grasshopper/Libraries/ \; 2>/dev/null || true \
    && find / -name "MillerMoth.gha" -exec cp -n {} /root/.config/Grasshopper/Libraries/ \; 2>/dev/null || true \
    && chown -R rhino-compute:rhino-compute /var/lib/rhino-compute 2>/dev/null || true

# 6. Setup application directories and Grasshopper plugin libraries
WORKDIR /app
RUN mkdir -p /app/plugins \
    /etc/rhino-compute \
    /var/log/rhino-compute && \
    chown -R rhino-compute:rhino-compute /var/log/rhino-compute /etc/rhino-compute 2>/dev/null || true

# Copy plugins directory (optional fallback)
COPY plugins/ /app/plugins/

# Copy entrypoint runner
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Default port: 5000 (McNeel default) / 8080 (Cloud Run)
ENV PORT=5000
EXPOSE 80
EXPOSE 5000
EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f -H "RhinoComputeKey: ${RHINO_COMPUTE_KEY}" http://localhost:${PORT:-5000}/healthcheck || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
