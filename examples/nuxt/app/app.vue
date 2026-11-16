<!-- <template>
    <div>Hello World</div>
</template>

<script setup>
    import {createApiClient} from "@image-saas/api";
    import {onMounted} from "vue";

    const apiClient = createApiClient({apiKey: "asd"})

    onMounted(()=>{
        apiClient.file.createPresignedUrl.mutate({
            filename: "",
            contentType: "image/png",
            size: 34105,
            appId: "01fd0ba9-6919-410a-8548-a48b5112cc05"
        })
    });
</script> -->

<template>
    <div>
        <Index />
    </div>
</template>

<script setup>
    import Index from "./Index.vue";
</script>