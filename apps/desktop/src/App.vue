<script setup lang="ts">
</script>

<template>
  <router-view />
</template>

<style>
* {
  box-sizing: border-box;
}
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  background: #f5f7fa;
}
/* 小票打印：仅打印区域可见 */
@media print {
  body * {
    visibility: hidden;
  }
  #receipt-area,
  #receipt-area * {
    visibility: visible;
  }
  #receipt-area {
    position: absolute;
    left: 0;
    top: 0;
    width: 58mm;
  }
}
</style>
