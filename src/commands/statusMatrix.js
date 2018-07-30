import path from 'path'

import { GitIgnoreManager } from '../managers/GitIgnoreManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { WORKDIR } from '../models/GitWalkerFs.js'
import { STAGE } from '../models/GitWalkerIndex.js'
import { TREE } from '../models/GitWalkerRepo.js'

import { walk } from './walk.js'

/**
 * Summarize the differences between a commit, the working dir, and the stage
 *
 * @link https://isomorphic-git.github.io/docs/statusMatrix.html
 */
export async function statusMatrix ({
  dir,
  gitdir = path.join(dir, '.git'),
  fs: _fs,
  ref = 'HEAD',
  filepath = ''
}) {
  try {
    const fs = new FileSystem(_fs)
    let results = await walk({
      fs,
      dir,
      gitdir,
      trees: [TREE(ref), WORKDIR, STAGE],
      filter: async function ([head, workdir, stage]) {
        // We need an awkward exception for the root directory
        if (head.fullpath === '.') return true
        // Ignore ignored files, but only if they are not already tracked.
        if (!head.exists && !stage.exists && workdir.exists) {
          if (
            await GitIgnoreManager.isIgnored({
              fs,
              dir,
              filepath: workdir.fullpath
            })
          ) {
            return false
          }
        }
        // match against filepath parameter
        if (head.fullpath.length >= filepath.length) {
          return head.fullpath.startsWith(filepath)
        } else if (head.fullpath.length < filepath.length) {
          return filepath.startsWith(head.fullpath)
        }
      },
      map: async function ([head, workdir, stage]) {
        // Figure out the oids, using the staged oid for the working dir oid if the stats match.
        await head.populateStat()
        await workdir.populateStat()
        await stage.populateStat()
        // For now, just bail on directories
        if (
          head.type === 'tree' ||
          workdir.type === 'tree' ||
          stage.type === 'tree'
        ) {
          return
        }
        await head.populateHash()
        await stage.populateHash()
        if (workdir.exists && stage.exists) {
          await workdir.populateHash()
        }
        if (!head.exists && workdir.exists && !stage.exists) {
          // We don't actually NEED the sha. Any sha will do
          // TODO: update this logic to handle N trees instead of just 3.
          workdir.oid = 42
        }
        let entry = [undefined, head.oid, workdir.oid, stage.oid]
        let result = entry.map(value => entry.indexOf(value))
        result.shift() // remove leading undefined entry
        let fullpath = head.fullpath || workdir.fullpath || stage.fullpath
        return [fullpath, ...result]
      }
    })
    return results
  } catch (err) {
    err.caller = 'git.statusMatrix'
    throw err
  }
}
