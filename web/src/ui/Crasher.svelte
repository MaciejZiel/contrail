<script lang="ts">
  // Test hook (?e2e=1&crashtest=1): throws while rendering to exercise the error boundary.
  const params = new URLSearchParams(location.search);
  if (params.has("e2e")) throw new Error("crash test");
</script>
