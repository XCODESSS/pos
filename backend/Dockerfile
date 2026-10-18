FROM gradle:8.14-jdk21 AS build
WORKDIR /workspace
COPY settings.gradle.kts build.gradle.kts ./
COPY src ./src
RUN gradle --no-daemon installDist

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/build/install/counterline-server/ ./
USER 10001
ENV HOST=0.0.0.0
EXPOSE 8080
ENTRYPOINT ["/app/bin/counterline-server"]
