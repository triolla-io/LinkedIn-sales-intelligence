import type { ReactDoctorConfig } from "react-doctor/api";

export default {
  ignore: {
    files: [
      "lib/generated/**",
      "whatsapp-service/**",
      "prisma/**",
      "extension/src/popup.ts"
    ],
    rules: [],
    overrides: [
      {
        files: [
          "package.json"
        ],
        rules: [
          "deslop/unused-dev-dependency"
        ]
      },
      {
        files: [
          "extension/src/lib/storage.ts",
          "extension/src/lib/api.ts"
        ],
        rules: [
          "deslop/unused-export"
        ]
      }
    ]
  }
} satisfies ReactDoctorConfig;
