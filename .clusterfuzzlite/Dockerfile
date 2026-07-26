FROM gcr.io/oss-fuzz-base/base-builder-javascript
COPY . $SRC/typechecker
WORKDIR $SRC/typechecker
COPY .clusterfuzzlite/build.sh $SRC/build.sh
