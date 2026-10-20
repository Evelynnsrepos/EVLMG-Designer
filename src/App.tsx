import { useEffect } from 'react'
import { installAutoBackup, waitForBackups } from '@/core/backups'
import { installCollaboration } from '@/core/collab'
import { gitSyncIdle, installGitSync } from '@/core/gitsync'
import { installCloseGuard, useAppStore, useSettings } from '@/core/state'
import { EditorScreen } from '@/shell/editor/EditorScreen'
import { Launcher } from '@/shell/launcher/Launcher'
import { NewProjectWizard } from '@/shell/launcher/NewProjectWizard'
import { useAiHelper } from '@/shared/spell'
import { RaritiesHost } from '@/shared/categories'
import { DialogHost } from '@/shared/ui'
import { JumpPickerHost } from '@/shared/jumps/Jumps'
import { DrawingShelfHost } from '@/shared/drawingShelf'
import { installRangeFill } from '@/shared/rangeFill'
import { HelpHost } from '@/shell/help/HelpHost'
import { HotwheelHost } from '@/shell/hotwheel/Hotwheel'
import { SettingsHost } from '@/shell/settings/SettingsDialog'
import { loadAllPlugins } from '@/shell/plugins/plugins'
import { ServerPluginOffer } from '@/shell/plugins/ServerPluginOffer'
import { SharingEndedHost } from '@/shell/collab/CollabDialogs'
import { GitSyncHost } from '@/shell/gitsync/GitSync'
import { installFileDrop } from '@/shell/fileDrop'
import { useJoinRequests } from '@/shell/collab/joinRequests'

// Shared projects go online when opened (core/collab).
installCollaboration()
// Git sync pulls on open and pushes on close (desktop only).
installGitSync()
// Files dropped from outside: Linux crash guard, and .txt/.md become Writer documents.
installFileDrop()
// Every slider shows its fill (v0.14).
installRangeFill()

export default function App() {
  const screen = useAppStore((s) => s.screen)
  useJoinRequests()

  useEffect(() => {
    // Spec 3.5: rolling backups, and save everything before the app closes.
    void useSettings.getState().load()
    void useAiHelper.getState().check()
    void loadAllPlugins()
    const stopBackups = installAutoBackup()
    // Quitting waits for the background Git push of the project just left.
    const stopGuard = installCloseGuard(async () => {
      await waitForBackups()
      await gitSyncIdle()
    })
    return () => {
      stopGuard()
      stopBackups()
    }
  }, [])

  return (
    <>
      {screen === 'launcher' && <Launcher />}
      {screen === 'new-project' && <NewProjectWizard />}
      {screen === 'editor' && <EditorScreen />}
      <DialogHost />
      <JumpPickerHost />
      <DrawingShelfHost />
      <HelpHost />
      <HotwheelHost />
      <SharingEndedHost />
      <ServerPluginOffer />
      <RaritiesHost />
      <SettingsHost />
      <GitSyncHost />
    </>
  )
}
