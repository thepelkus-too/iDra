// App-private UI preferences (PiP size, fade length, freeze memory) under the `hydra-rack:` key prefix. Never sketches.
import { appStorage } from '@hydra-ipad/core'

export const appPrefs = appStorage('rack')
